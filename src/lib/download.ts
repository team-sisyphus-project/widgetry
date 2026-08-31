import type { ExportFile } from './export'
import { zipSync } from './export/zip'

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadFile(file: ExportFile): void {
  save(new Blob([file.content], { type: 'text/plain;charset=utf-8' }), file.name)
}

export function downloadZip(folder: string, files: ExportFile[]): void {
  save(
    zipSync(files.map((f) => ({ name: `${folder}/${f.name}`, content: f.content }))),
    `${folder}.zip`,
  )
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
