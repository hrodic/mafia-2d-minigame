// Fixed-step accumulator shared by the main loop. Pure: callers supply the step.

/**
 * Consume accumulated frame time in fixed steps.
 * When the step cap is hit with time still queued, the backlog is dropped to
 * avoid a catch-up spiral after a long stall.
 */
export function advanceFixedStep(accumulator, frameDt, step, maxSteps, onStep) {
  let remaining = accumulator + Math.max(0, frameDt);
  let steps = 0;

  while (remaining >= step && steps < maxSteps) {
    onStep(step);
    remaining -= step;
    steps++;
  }

  const dropped = steps >= maxSteps && remaining >= step;
  if (dropped) remaining = 0;

  return { accumulator: remaining, steps, dropped };
}
