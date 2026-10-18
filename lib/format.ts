export function formatBlockTime(seconds: number): string {
  return `${new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;
}
