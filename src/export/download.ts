/** Hands a Blob to the browser as a download. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // The click has taken its reference; release ours once the dust settles.
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
