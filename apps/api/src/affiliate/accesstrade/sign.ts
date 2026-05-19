export function buildAccessTradeHeaders(accessKey: string) {
  return {
    headers: {
      Authorization: `Token ${accessKey}`,
      "Content-Type": "application/json",
    },
  };
}
