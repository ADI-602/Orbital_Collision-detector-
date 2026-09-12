import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useReplayClock — the replay's single source of time.
 *
 * WHY THIS IS A HOOK AND NOT THE GLOBE'S BUSINESS. The globe used to own the
 * animation clock, and the countdown read it from the globe's telemetry. That
 * works right up until the globe does not render — no WebGL on a conference
 * laptop, a driver fault, a failed Cesium init — at which point the countdown
 * received no clock, silently fell back to real time, and displayed
 * "T+7995d" under a label that still read "replay clock ×60". A readout
 * labelled with a clock it is not actually counting against is precisely the
 * kind of quiet lie this project exists not to tell.
 *
 * So time lives here, independent of rendering. The globe consumes it. If the
 * globe fails, the countdown, the HUD and the narrative are all still right.
 *
 * TWO READERS, ONE CLOCK, DIFFERENT RATES:
 *   getSimTime()  read per animation frame by the globe — a ref, so smooth
 *                 motion never costs a React render
 *   simTime       React state at ~4 Hz, for the countdown and the HUD, which
 *                 display whole seconds and do not need 60 fps
 * Both read the same accumulator, so they cannot drift apart.
 *
 * @param {object} options
 * @param {number|null} options.epochBaseMs simulated instant at t=0
 * @param {number} options.speed            simulated seconds per real second
 * @param {boolean} [options.paused]
 * @param {number} [options.runId]          bump to restart from the epoch
 * @returns {{ simTime: Date|null, getSimTime: () => Date|null }}
 */
export function useReplayClock({ epochBaseMs, speed, paused = false, runId = 0 }) {
  const [simTime, setSimTime] = useState(null)

  /** Real milliseconds counted toward the simulation; a pause stops adding. */
  const elapsedRef = useRef(0)
  /** Latest simulated instant, in epoch ms. */
  const simMsRef = useRef(null)

  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const speedRef = useRef(speed)
  speedRef.current = speed

  useEffect(() => {
    if (epochBaseMs === null || epochBaseMs === undefined) {
      simMsRef.current = null
      setSimTime(null)
      return undefined
    }

    // A restart returns to the same epoch, so the accumulator is what resets.
    elapsedRef.current = 0
    simMsRef.current = epochBaseMs
    setSimTime(new Date(epochBaseMs))

    let frame = 0
    let lastFrame = performance.now()
    let lastPush = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const now = performance.now()
      const frameMs = now - lastFrame
      lastFrame = now
      if (!pausedRef.current) elapsedRef.current += frameMs

      simMsRef.current = epochBaseMs + elapsedRef.current * speedRef.current

      if (now - lastPush > 250) {
        lastPush = now
        setSimTime(new Date(simMsRef.current))
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [epochBaseMs, runId])

  const getSimTime = useCallback(
    () => (simMsRef.current === null ? null : new Date(simMsRef.current)),
    [],
  )

  return { simTime, getSimTime }
}
