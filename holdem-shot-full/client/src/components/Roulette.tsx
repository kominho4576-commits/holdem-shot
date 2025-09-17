import { useEffect, useMemo, useState } from 'react'
import { RoulettePayload } from '../state/gameTypes'

type Props = {
  data?: RoulettePayload
  flash: 'none'|'red'|'white'
  countdown?: number | null  // 남은 초를 표시 (자동 시작용)
}

export default function Roulette({ data, flash, countdown }: Props) {
  const [angle, setAngle] = useState(0)
  const cells = useMemo(()=>[0,1,2,3,4,5],[])

  useEffect(()=>{
    if (!data) return
    // 각 step = 60deg; 시계 방향 회전
    const final = data.rotatedSteps * 60
    // 절대각도로 맞춤(누적 아님)
    setTimeout(()=> setAngle(final), 30)
  }, [data?.rotatedSteps])

  return (
    <div className={`roulette ${flash !== 'none' ? (flash==='red'?'flash-red':'flash-white') : ''}`}>
      <div className="wheel" style={{ transform: `rotate(${angle}deg)` }}>
        {cells.map(i=>{
          const hasBullet = data?.chambers?.[i]===1
          return <div key={i} className={`cell ${hasBullet ? 'bullet' : ''}`} />
        })}
        <div className="center-dot" />
      </div>

      {/* 역삼각형(▽) */}
      <svg className="arrow" width="28" height="18" viewBox="0 0 28 18">
        <polygon points="14,18 0,0 28,0" fill="#6f66d5" />
      </svg>

      <div className={`rr-text ${data?.text==='BANG!' ? 'bang' : 'safe'}`}>
        {data?.text || (countdown!=null ? `Starts in ${countdown}s` : '')}
      </div>
    </div>
  )
}
