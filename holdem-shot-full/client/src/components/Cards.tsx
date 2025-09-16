import React from 'react'

type CardProps = {
  face?: string   // like 'AS', 'TD', 'JK1' ...
  back?: boolean
  selected?: boolean
  onClick?: () => void
  blink?: boolean
}

export function Card({ face, back, selected, onClick, blink }: CardProps) {
  return (
    <div
      className={`card ${back ? 'back' : ''} ${selected ? 'sel' : ''} ${blink ? 'blink' : ''}`}
      onClick={onClick}
      role="button"
    >
      {!back && <span className="card-face">{pretty(face||'')}</span>}
    </div>
  )
}

export function CardBack() { return <div className="card back" /> }

export function CardRow({ children }: { children: React.ReactNode }) {
  return <div className="card-row">{children}</div>
}

function pretty(code: string) {
  if (!code) return ''
  if (code.startsWith('JK')) return 'JOKER'
  const rank = code[0]
  const suit = code[1]
  const suitMap: any = { S: '♠', H: '♥', D: '♦', C: '♣' }
  return `${rank}${suitMap[suit] || ''}`
}
