export interface RangeRequestOptions {
  start?: number;
  end?: number;
}

export async function fetchWithRange(
  url: string,
  options: RangeRequestOptions
): Promise<Response> {
  const headers: HeadersInit = {};

  if (options.start !== undefined || options.end !== undefined) {
    const start = options.start ?? 0;
    const end = options.end ?? '';
    headers['Range'] = `bytes=${start}-${end}`;
  }

  return fetch(url, { headers });
}

export async function getFileSize(url: string): Promise<number> {
  const response = await fetch(url, { method: 'HEAD' });
  const contentLength = response.headers.get('content-length');
  return contentLength ? parseInt(contentLength, 10) : 0;
}

export async function readParquetFooter(url: string): Promise<ArrayBuffer> {
  // Get file size
  const fileSize = await getFileSize(url);

  // Read last 8 bytes to get footer size
  const sizeResponse = await fetchWithRange(url, {
    start: fileSize - 8,
    end: fileSize - 1,
  });

  const sizeBuffer = await sizeResponse.arrayBuffer();
  const footerSize = new DataView(sizeBuffer).getInt32(0, true);

  // Read footer
  const footerStart = fileSize - 8 - footerSize;
  const footerResponse = await fetchWithRange(url, {
    start: footerStart,
    end: fileSize - 9,
  });

  return footerResponse.arrayBuffer();
}

export async function readParquetColumnChunk(
  url: string,
  offset: number,
  length: number
): Promise<ArrayBuffer> {
  const response = await fetchWithRange(url, {
    start: offset,
    end: offset + length - 1,
  });
  return response.arrayBuffer();
}
