function replacePlaceholders(content: string, values: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{${key}}`;
    result = result.split(placeholder).join(value);
  }
  return result;
}

export { replacePlaceholders };