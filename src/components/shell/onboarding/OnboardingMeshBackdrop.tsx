import { useEffect, useRef } from 'react'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

function createParticles(width: number, height: number, count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.55,
    vy: (Math.random() - 0.5) * 0.55,
    radius: Math.random() * 1.6 + 0.8,
  }))
}

export function OnboardingMeshBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    let frame = 0
    let animationHandle = 0
    let particles: Particle[] = []

    const resize = () => {
      const { clientWidth, clientHeight } = canvas
      canvas.width = Math.max(1, Math.floor(clientWidth * window.devicePixelRatio))
      canvas.height = Math.max(1, Math.floor(clientHeight * window.devicePixelRatio))
      context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0)
      particles = createParticles(clientWidth, clientHeight, 74)
    }

    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      context.clearRect(0, 0, width, height)
      context.fillStyle = 'rgba(13, 26, 17, 0.92)'
      context.fillRect(0, 0, width, height)

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]
        particle.x += particle.vx
        particle.y += particle.vy

        if (particle.x <= 0 || particle.x >= width) {
          particle.vx *= -1
        }
        if (particle.y <= 0 || particle.y >= height) {
          particle.vy *= -1
        }

        for (let second = index + 1; second < particles.length; second += 1) {
          const peer = particles[second]
          const dx = particle.x - peer.x
          const dy = particle.y - peer.y
          const distance = Math.hypot(dx, dy)

          if (distance < 116) {
            const alpha = (1 - distance / 116) * 0.32
            context.strokeStyle = `rgba(143, 203, 155, ${alpha})`
            context.lineWidth = 1
            context.beginPath()
            context.moveTo(particle.x, particle.y)
            context.lineTo(peer.x, peer.y)
            context.stroke()
          }
        }

        context.fillStyle = index % 9 === 0 ? 'rgba(143, 203, 155, 0.92)' : 'rgba(74, 124, 89, 0.9)'
        context.beginPath()
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        context.fill()
      }

      frame += 1
      animationHandle = window.requestAnimationFrame(draw)
    }

    resize()
    draw()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      window.cancelAnimationFrame(animationHandle)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  )
}
