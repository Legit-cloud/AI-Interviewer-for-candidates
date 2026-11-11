from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InterviewPreferences, InterviewSession, TranscriptSegment


async def purge_expired_transcripts(db: AsyncSession, user_id: UUID | None = None) -> int:
    """Deletes retained transcript segments that have passed the user's retention_days policy."""
    prefs_stmt = select(InterviewPreferences)
    if user_id is not None:
        prefs_stmt = prefs_stmt.where(InterviewPreferences.user_id == user_id)
    prefs_rows = (await db.execute(prefs_stmt)).scalars().all()
    if not prefs_rows:
        return 0

    now = datetime.now(timezone.utc)
    purged_sessions = 0
    for prefs in prefs_rows:
        cutoff = now - timedelta(days=max(1, prefs.retention_days))
        expired_sessions = (
            await db.execute(
                select(InterviewSession).where(
                    InterviewSession.user_id == prefs.user_id,
                    InterviewSession.transcript_retained.is_(True),
                    InterviewSession.started_at < cutoff,
                )
            )
        ).scalars().all()
        if not expired_sessions:
            continue
        session_ids = [s.id for s in expired_sessions]
        await db.execute(
            delete(TranscriptSegment).where(TranscriptSegment.session_id.in_(session_ids))
        )
        for sess in expired_sessions:
            sess.transcript_retained = False
        purged_sessions += len(session_ids)

    if purged_sessions:
        await db.commit()
    return purged_sessions

