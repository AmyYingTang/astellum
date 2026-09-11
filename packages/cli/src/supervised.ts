/**
 * Exit when the process that launched us is gone.
 *
 * The hub starts the studio and the kiosk as child processes and kills them on
 * Ctrl+C, which works — but only for a clean shutdown. Kill the hub with -9, or
 * have it crash, and both children are reparented to init and keep serving on
 * their ports with nothing in front of them. The next `./astellum` then
 * fails to bind, and the fix is hunting stray PIDs.
 *
 * A child cannot be notified of that on POSIX, so it has to notice: once
 * reparented, `process.ppid` becomes 1. Checking twice a second is far cheaper
 * than what it prevents, and the timer is unref'd so it never keeps an
 * otherwise-idle process alive.
 */
export function exitWhenOrphaned(intervalMs = 2000): void {
  if (!process.env.ASTELLUM_SUPERVISED) return; // started directly — not our business
  const parent = process.ppid;
  const timer = setInterval(() => {
    if (process.ppid !== parent) {
      console.error('astellum: parent process is gone — shutting down.');
      process.exit(0);
    }
  }, intervalMs);
  timer.unref();
}
