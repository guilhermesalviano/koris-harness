export function validateBaseUrl(baseUrl: string): string {
    let parsed: URL;

    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error(`Invalid AI base URL: ${baseUrl}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported AI base URL protocol: ${parsed.protocol}`);
    }

    if (parsed.username || parsed.password) {
      throw new Error('AI base URL must not include credentials');
    }

    return parsed.origin;
}