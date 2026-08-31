import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'

import { computeSimTime, DEFAULT_SPEED_MULTIPLIER } from '../../lib/simClock.js'
import './CesiumGlobe.css'

/**
 * CesiumGlobe — the console's hero view: a freely rotatable Earth with real
 * tracked objects in their real orbits.
 *
 * Rendering is driven imperatively from a requestAnimationFrame loop rather
 * than from React state, because re-rendering the tree 60x/second to move a
 * marker would be wasteful. React only hears about it on a throttle, via
 * `onTelemetry`, which feeds the HUD readouts.
 *
 * See useLiveSatellites.js for the boundary note: these positions are an
 * ambient visualisation, never an input to the physics pipeline.
 *
 * @param {object} props
 * @param {(when: Date) => Array<object>} props.propagateAll
 * @param {number} props.satelliteCount           re-seeds entities when the set loads
 * @param {number} [props.speedMultiplier]
 * @param {(t: {simTime: Date, satellites: Array<object>}) => void} [props.onTelemetry]
 * @param {(id: string | null) => void} [props.onSelect]
 * @param {string | null} [props.selectedId]
 */
function CesiumGlobe({
  propagateAll,
  satelliteCount,
  speedMultiplier = DEFAULT_SPEED_MULTIPLIER,
  onTelemetry,
  onSelect,
  selectedId = null,
}) {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const entitiesRef = useRef(new Map())

  // Props the animation loop reads. Held in refs so the loop never needs to be
  // torn down and rebuilt (which would destroy and recreate the viewer).
  const propagateRef = useRef(propagateAll)
  propagateRef.current = propagateAll
  const speedRef = useRef(speedMultiplier)
  speedRef.current = speedMultiplier
  const telemetryRef = useRef(onTelemetry)
  telemetryRef.current = onTelemetry
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  // --- Viewer lifecycle: created once, destroyed on unmount ---------------
  useEffect(() => {
    let disposed = false
    let handler = null
    // Captured here rather than read off the ref during cleanup: the Map
    // identity is stable for the component's life, and the local binding is
    // what the exhaustive-deps rule wants to see.
    const entities = entitiesRef.current

    const init = async () => {
      const token = import.meta.env?.VITE_CESIUM_ION_TOKEN

      /** @type {Cesium.Viewer.ConstructorOptions} */
      const options = {
        // Cesium's stock chrome is a toolbar-heavy look that fights the
        // console design. The only UI over the globe is our own HUD.
        baseLayerPicker: false,
        timeline: false,
        animation: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        // Attribution stays (Cesium/Natural Earth require it); it is styled
        // down in CSS rather than removed.
        creditContainer: undefined,
      }

      if (token) {
        Cesium.Ion.defaultAccessToken = token
      } else {
        // No Ion token: fall back to the offline Natural Earth II tiles that
        // ship inside the cesium package. Lower resolution, but the globe
        // works with zero network dependency — which also means a demo on
        // bad conference wifi still renders.
        const provider = await Cesium.TileMapServiceImageryProvider.fromUrl(
          Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
        )
        if (disposed) return
        options.baseLayer = new Cesium.ImageryLayer(provider)
        options.terrainProvider = new Cesium.EllipsoidTerrainProvider()
      }

      if (disposed || !containerRef.current) return

      const viewer = new Cesium.Viewer(containerRef.current, options)
      viewerRef.current = viewer

      // Space should read as black, not as Cesium's default blue skybox glow.
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#050505')
      viewer.scene.skyAtmosphere.show = true
      viewer.scene.globe.enableLighting = true
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0f18')
      viewer.scene.moon.show = false

      // Close enough that Earth fills most of the stage, far enough that a
      // whole LEO orbit stays in frame as objects sweep around the limb.
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(10, 15, 24_000_000),
      })

      // Click-to-select. Cesium hands back the picked entity; we translate to
      // our own id so React state never holds a Cesium object.
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
      handler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position)
        const id = picked?.id?.id
        selectRef.current?.(typeof id === 'string' ? id : null)
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    }

    init().catch((err) => {
      // A failed globe must not take down the console around it.
      console.error('Cesium viewer failed to initialise:', err)
    })

    return () => {
      disposed = true
      handler?.destroy()
      entities.clear()
      const viewer = viewerRef.current
      viewerRef.current = null
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
    }
  }, [])

  // --- Animation loop: propagate and move markers -------------------------
  useEffect(() => {
    let frame = 0
    let lastPush = 0
    const startedAtReal = performance.now()
    const simBase = new Date()

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const viewer = viewerRef.current
      if (!viewer || viewer.isDestroyed()) return

      const elapsed = performance.now() - startedAtReal
      const simTime = computeSimTime(simBase, elapsed, speedRef.current)
      const satellites = propagateRef.current?.(simTime) ?? []

      for (const sat of satellites) {
        let entity = entitiesRef.current.get(sat.id)
        const position = Cesium.Cartesian3.fromDegrees(
          sat.longitude_deg,
          sat.latitude_deg,
          sat.altitude_km * 1000,
        )

        if (!entity) {
          entity = viewer.entities.add({
            id: sat.id,
            position,
            point: {
              pixelSize: 6,
              color: Cesium.Color.fromCssColorString('#e4e4e7'),
              outlineColor: Cesium.Color.fromCssColorString('#5fd9d0'),
              outlineWidth: 1.5,
            },
            label: {
              text: sat.name,
              font: '500 11px Inter, system-ui, sans-serif',
              fillColor: Cesium.Color.fromCssColorString('#a1a1aa'),
              showBackground: false,
              pixelOffset: new Cesium.Cartesian2(10, 0),
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              // Generous ceiling so labels are readable at the default
              // camera distance; they drop away only when zoomed right out.
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8.0e7),
              // Keep the label from being drawn over by the globe when its
              // satellite passes behind the limb.
              disableDepthTestDistance: 0,
            },
          })
          entitiesRef.current.set(sat.id, entity)
        } else {
          entity.position = position
        }

        const isSelected = selectedRef.current === sat.id
        entity.point.pixelSize = isSelected ? 11 : 6
        entity.point.color = Cesium.Color.fromCssColorString(
          isSelected ? '#5fd9d0' : '#e4e4e7',
        )
      }

      // Throttle React updates: the HUD only needs a few refreshes a second,
      // and pushing state every frame would re-render the whole console.
      const now = performance.now()
      if (now - lastPush > 250) {
        lastPush = now
        telemetryRef.current?.({ simTime, satellites })
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [satelliteCount])

  return <div className="cesium-globe" ref={containerRef} />
}

export default CesiumGlobe
