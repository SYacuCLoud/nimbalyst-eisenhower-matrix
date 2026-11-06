import type { PanelExport } from '@nimbalyst/extension-sdk'
import { MatrixPanel } from './ui/MatrixPanel'
import './styles.css'

export const panels: Record<string, PanelExport> = {
  matrix: { component: MatrixPanel }
}

export function activate() {}

export function deactivate() {}
