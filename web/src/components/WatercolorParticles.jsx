import { useEffect, useRef, useCallback } from 'react'

const COLORS = [
  'hsla(280, 38%, 88%, ',
  'hsla(275, 42%, 85%, ',
  'hsla(268, 36%, 90%, ',
  'hsla(285, 34%, 86%, ',
  'hsla(272, 40%, 82%, ',
  'hsla(283, 32%, 87%, ',
  'hsla(262, 28%, 88%, ',
  'hsla(278, 44%, 80%, ',
  'hsla(290, 30%, 84%, ',
  'hsla(276, 36%, 86%, ',
]

export default function WatercolorParticles() {
  const canvasRef  = useRef(null)
  const particles  = useRef([])
  const mouse      = useRef({ x: 0, y: 0, isMoving: false })
  const lastMouse  = useRef({ x: 0, y: 0 })
  const mouseReady = useRef(false)
  const rafRef     = useRef(null)
  const runningRef = useRef(false)

  const MAX_TRAIL_SEGMENT = 96

  const createParticle = useCallback((x, y, isVapor = false) => {
    const angle = Math.random() * Math.PI * 2
    const speed = isVapor ? Math.random() * 1 + 0.3 : Math.random() * 3 + 1
    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: isVapor ? -Math.random() * 1.5 - 0.5 : Math.sin(angle) * speed,
      size:  isVapor ? Math.random() * 10 + 5  : Math.random() * 25 + 12,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: isVapor ? Math.random() * 0.1 + 0.05 : Math.random() * 0.22 + 0.12,
      life: 0,
      maxLife: isVapor ? Math.random() * 80 + 40 : Math.random() * 180 + 120,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.03,
      type: isVapor ? 'vapor' : 'blob',
    }
  }, [])

  const drawGlow = useCallback((ctx, x, y, size, color, alpha) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2)
    g.addColorStop(0,   `${color}${alpha * 0.5})`)
    g.addColorStop(0.3, `${color}${alpha * 0.2})`)
    g.addColorStop(1,   `${color}0)`)
    ctx.beginPath(); ctx.arc(x, y, size * 2, 0, Math.PI * 2)
    ctx.fillStyle = g; ctx.fill()
  }, [])

  const drawBlob = useCallback((ctx, p) => {
    const lr = p.life / p.maxLife
    const fa = p.alpha * (1 - lr)
    drawGlow(ctx, p.x, p.y, p.size, p.color, fa)
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation)
    for (let i = 0; i < 4; i++) {
      const ls = p.size * (1 - i * 0.12)
      const la = fa * (1 - i * 0.15)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ls)
      g.addColorStop(0,    `${p.color}${la})`)
      g.addColorStop(0.25, `${p.color}${la * 0.8})`)
      g.addColorStop(0.5,  `${p.color}${la * 0.4})`)
      g.addColorStop(0.75, `${p.color}${la * 0.15})`)
      g.addColorStop(1,    `${p.color}0)`)
      ctx.beginPath()
      const pts = 10
      for (let j = 0; j <= pts; j++) {
        const a = (j / pts) * Math.PI * 2
        const r = ls * (1 + Math.sin(a * 4 + p.rotation * 2) * 0.35)
        j === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
                : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      ctx.closePath(); ctx.fillStyle = g; ctx.fill()
    }
    ctx.restore()
  }, [drawGlow])

  const drawVapor = useCallback((ctx, p) => {
    const lr  = p.life / p.maxLife
    const fa  = p.alpha * (1 - lr * lr)
    const es  = p.size * (1 + lr * 2)
    const g   = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, es)
    g.addColorStop(0,   `${p.color}${fa})`)
    g.addColorStop(0.4, `${p.color}${fa * 0.5})`)
    g.addColorStop(1,   `${p.color}0)`)
    ctx.beginPath(); ctx.arc(p.x, p.y, es, 0, Math.PI * 2)
    ctx.fillStyle = g; ctx.fill()
  }, [])

  const spawnFromMouse = useCallback(() => {
    const mx = mouse.current.x
    const my = mouse.current.y

    if (!mouseReady.current) {
      lastMouse.current = { x: mx, y: my }
      mouseReady.current = true
      particles.current.push(createParticle(mx, my, false))
      mouse.current.isMoving = false
      return
    }

    const dx = mx - lastMouse.current.x
    const dy = my - lastMouse.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > MAX_TRAIL_SEGMENT) {
      lastMouse.current = { x: mx, y: my }
      particles.current.push(createParticle(mx, my, false))
      if (Math.random() > 0.65) particles.current.push(createParticle(mx, my, true))
      mouse.current.isMoving = false
      return
    }

    const n = Math.min(Math.floor(dist / 5) + 1, 4)
    for (let i = 0; i < n; i++) {
      const t = i / n
      const px = lastMouse.current.x + dx * t + (Math.random() - 0.5) * 40
      const py = lastMouse.current.y + dy * t + (Math.random() - 0.5) * 40
      particles.current.push(createParticle(px, py, false))
      if (Math.random() > 0.7) particles.current.push(createParticle(px, py, true))
    }
    if (dist > 20 && Math.random() > 0.5) {
      particles.current.push(
        createParticle(mx + (Math.random() - 0.5) * 60, my + (Math.random() - 0.5) * 60, false),
      )
    }
    lastMouse.current = { x: mx, y: my }
    mouse.current.isMoving = false
  }, [createParticle])

  const animate = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const hasParticles = particles.current.length > 0
    const isMoving = mouse.current.isMoving

    if (hasParticles || isMoving) {
      if (hasParticles) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      if (isMoving) spawnFromMouse()

      particles.current = particles.current.filter(p => {
        p.life++
        p.x += p.vx; p.y += p.vy
        p.vx *= 0.97; p.vy *= p.type === 'vapor' ? 0.99 : 0.97
        p.rotation += p.rotationSpeed
        if (p.type === 'blob') {
          p.size += 0.4
          if (p.life > 20 && Math.random() > 0.92)
            particles.current.push(createParticle(p.x, p.y - 5, true))
        } else {
          p.size += 0.6
        }
        if (p.life < p.maxLife) {
          p.type === 'vapor' ? drawVapor(ctx, p) : drawBlob(ctx, p)
          return true
        }
        return false
      })

      if (particles.current.length > 100)
        particles.current = particles.current.slice(-100)
    }

    if (!hasParticles && !isMoving && runningRef.current) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    rafRef.current = requestAnimationFrame(animate)
  }, [spawnFromMouse, createParticle, drawBlob, drawVapor])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const section = canvas.parentElement
    if (!section) return

    const resize = () => {
      canvas.width  = section.offsetWidth
      canvas.height = section.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, isMoving: true }
    }
    const onTouch = (e) => {
      const r = canvas.getBoundingClientRect()
      const t = e.touches[0]
      mouse.current = { x: t.clientX - r.left, y: t.clientY - r.top, isMoving: true }
    }
    const onLeave = () => {
      mouseReady.current = false
    }

    section.addEventListener('mousemove', onMove)
    section.addEventListener('touchmove', onTouch, { passive: true })
    section.addEventListener('mouseleave', onLeave)

    runningRef.current = true
    rafRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resize)
      section.removeEventListener('mousemove', onMove)
      section.removeEventListener('touchmove', onTouch)
      section.removeEventListener('mouseleave', onLeave)
      runningRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [animate])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-0"
      style={{ mixBlendMode: 'normal', pointerEvents: 'none' }}
      aria-hidden="true"
    />
  )
}
