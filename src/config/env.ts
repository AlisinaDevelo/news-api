export function requireApiKeyUnlessTest(): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const key = process.env.GNEWS_API_KEY?.trim();
  if (!key) {
    console.error("GNEWS_API_KEY is missing. Copy .env.example to .env and set your key.");
    process.exit(1);
  }
}
