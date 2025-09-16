import { useEffect, useMemo, useRef, useState } from 'react'
import { RoulettePayload } from '../state/gameTypes'

type Props = {
  data?: RoulettePayload
  flash: 'none'|'red'|'white'
}

export default function Roulette({ data, flash }: Props) {
  const [angle, setAngle] = useState(0)
  const wheelRef = useRef<HTMLDivElement>(null)

  const cells = useMemo(()=>[0,1,2,3,4,5],[])

  useEffect(()=>{
    if (!data) return
    // each step = 60deg; rotate CW
    const final = angle + data.rotatedSteps * 60
    setTimeout(()=> setAngle(final), 30)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.rotatedSteps])

  return (
    <div className={`roulette ${flash !== 'none' ? (flash==='red'?'flash-red':'flash-white') : ''}`}>
      <div className="wheel" ref={wheelRef} style={{ transform: `rotate(${angle}deg)` }}>
        {cells.map(i=>{
          const hasBullet = data?.chambers?.[i]===1
          return (
            <div key={i} className={`cell ${hasBullet ? 'bullet' : ''}`} />
          )
        })}
        <div className="center-dot" />
      </div>
      <div className="arrow" />
      <div className={`rr-text ${data?.text==='BANG!' ? 'bang' : 'safe'}`}>
        {data?.text || ''}
      </div>
    </div>
  )
}
