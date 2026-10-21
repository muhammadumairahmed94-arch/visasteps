/** Runs once when the server starts: OneDrive retries and reminder emails. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackgroundJobs } = await import("./lib/jobs");
  startBackgroundJobs();
}
