/**
 * Motion primitives built on Motion (Framer Motion) (`motion/react`).
 *
 * All motion is subtle (150-450ms, ease-out-quart), uses transform/opacity only,
 * and is disabled automatically for users with `prefers-reduced-motion` via the
 * <MotionConfig reducedMotion="user"> set in the root route.
 */
import { motion, type HTMLMotionProps, type Variants } from "motion/react";
import type { ReactNode } from "react";

export const EASE = [0.25, 1, 0.5, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.35, ease: EASE } },
};

/** Fades + lifts content into view once when scrolled into the viewport. */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
  ...rest
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article" | "header";
} & Omit<HTMLMotionProps<"div">, "children">) {
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.12 }}
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE, delay } },
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/** Parent that staggers its <StaggerItem> children on mount (or in view). */
export function Stagger({
  children,
  className,
  inView = false,
  gap = 0.06,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  inView?: boolean;
  gap?: number;
  delay?: number;
}) {
  const variants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: gap, delayChildren: delay } },
  };
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      {...(inView ? { whileInView: "show", viewport: { once: true, amount: 0.1 } } : { animate: "show" })}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "article";
}) {
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp className={className} variants={fadeUp}>
      {children}
    </Comp>
  );
}

/** Wraps page content for a soft enter transition between routes. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export { motion, AnimatePresence } from "motion/react";

