import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'

import { alignTrackToInstant } from '../../lib/maneuver.js'
import { markerImage, markerPixelSize } from '../../lib/markerImage.js'
import { OBJECT_KIND } from '../../lib/objectType.js'
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
 * @param {{primaryId: string, secondaryId: string, colorHex: string} | null} [props.highlightPair]
 *   the two objects of the currently selected conjunction event, and the
 *   colour to draw them in — see lib/conjunctions.js riskColorHex(). On the
 *   live console only a LIVE event supplies this (see hasGlobePresence());
 *   the replay view always supplies its one pair.
 * @param {((id: string, when: Date) => Array<{x: number, y: number, z: number}>|null) | null} [props.orbitTrackFor]
 *   one revolution of an object's orbit in Earth-fixed km, for the instant
 *   being drawn — see lib/orbitTrack.js. Supplied by whichever hook owns the
 *   element sets. Rings are drawn for the highlighted pair and, failing that,
 *   the selected object; null means that object gets no ring.
 * @param {{tracks: object, colorHex: string} | null} [props.maneuverOverlay]
 *   the flown and unflown arcs for a simulated burn, straight from
 *   /api/physics/maneuver. Drawn for context — at orbit scale the two arcs are
 *   the same line, and the burn's actual effect is shown to scale in
 *   ManeuverPanel. See lib/maneuver.js.
 * @param {((elapsedRealMs: number) => Date) | null} [props.simTimeFor]
 *   overrides which instant is drawn. The live console leaves this null and
 *   gets a clock that starts now and runs forward at `speedMultiplier`; the
 *   Envisat replay supplies a clock that sweeps a fixed window in 2004 and
 *   wraps (lib/replay.js replaySimTime). Positions are propagated by SGP4 for
 *   whatever instant comes back, so the override changes WHICH instants are
 *   sampled and nothing else.
 * @param {string|number} [props.clockKey] restarts the clock when it changes —
 *   the replay passes its TCA, which is not known on the first render.
 * @param {number} [props.telemetryIntervalMs] how often React hears about the
 *   clock. The default is deliberately coarse; the replay lowers it because a
 *   countdown refreshed only four times a second visibly stutters.
 */
/**
 * Marker colours. Neutral by default so the risk palette keeps its meaning:
 * on this globe a coloured marker means an assessed conjunction, and nothing
 * else. Object TYPE is carried by shape (lib/objectType.js), never by colour.
 */
const MARKER_DEFAULT_HEX = '#c8c8d0'
const MARKER_SELECTED_HEX = '#5fd9d0'

/**
 * Labels are drawn for at most this many objects at once.
 *
 * A tracked set of several hundred debris fragments produces several hundred
 * overlapping labels — illegible, and text is by far the most expensive thing
 * Cesium draws per entity. So labels are reserved for the objects a viewer is
 * actually being pointed at: the selected object and the two members of a
 * highlighted conjunction. Everything else is a shape until you click it.
 */
const LABELLED_ONLY = true

/**
 * How often the orbit rings are re-sampled, in milliseconds of REAL time.
 *
 * Each ring costs 129 SGP4 propagations and at most three exist at once, so
 * 4 Hz is ~1,500 propagations a second — nothing. Doing it per frame at 60 Hz
 * would not be. Between refreshes the ring is stale by at most 250 ms x the
 * speed multiplier of orbital motion, which at the default x120 is a marker
 * displacement of well under a pixel at any usable zoom.
 */
const TRACK_REFRESH_MS = 250

/** Ring opacity: present enough to read, faint enough not to fight the markers. */
const TRACK_ALPHA = 0.85
const TRACK_DEPTH_FAIL_ALPHA = 0.28

function CesiumGlobe({
  propagateAll,
  satelliteCount,
  speedMultiplier = DEFAULT_SPEED_MULTIPLIER,
  onTelemetry,
  onSelect,
  selectedId = null,
  highlightPair = null,
  orbitTrackFor = null,
  maneuverOverlay = null,
  simTimeFor = null,
  clockKey = 'live',
  telemetryIntervalMs = 250,
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
  const highlightRef = useRef(highlightPair)
  highlightRef.current = highlightPair
  const orbitTrackForRef = useRef(orbitTrackFor)
  orbitTrackForRef.current = orbitTrackFor
  const maneuverRef = useRef(maneuverOverlay)
  maneuverRef.current = maneuverOverlay
  const simTimeForRef = useRef(simTimeFor)
  simTimeForRef.current = simTimeFor
  const telemetryIntervalRef = useRef(telemetryIntervalMs)
  telemetryIntervalRef.current = telemetryIntervalMs
  const linkEntityRef = useRef(null)
  // Read by the polyline's CallbackProperty every frame; see the tick below.
  const linkPositionsRef = useRef([])
  const linkColorRef = useRef(null)
  // id -> { entity, holder: {points}, colorHex }. `holder` is what each ring's
  // CallbackProperty closes over, so the entity is built once and its geometry
  // is swapped by mutating the holder — same reason as the link line below.
  const trackEntitiesRef = useRef(new Map())

  // --- Viewer lifecycle: created once, destroyed on unmount ---------------
  useEffect(() => {
    let disposed = false
    let handler = null
    // Captured here rather than read off the ref during cleanup: the Map
    // identity is stable for the component's life, and the local binding is
    // what the exhaustive-deps rule wants to see.
    const entities = entitiesRef.current
    const tracks = trackEntitiesRef.current

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
        // A billboard pick reports its Entity on `.id`; the entity's own id is
        // the tracked-set id we handed it. Anything else deselects.
        //
        // Membership of the marker map is the test, not "is it a string": the
        // conjunction chord and the orbit rings are pickable entities too, and
        // Cesium gives an entity added without an id an auto-generated GUID —
        // also a string. Clicking a line would otherwise select an object id
        // that does not exist, which empties the selected-object panel instead
        // of doing nothing.
        const id = picked?.id?.id
        const isTrackedObject = typeof id === 'string' && entities.has(id)
        selectRef.current?.(isTrackedObject ? id : null)
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
      tracks.clear()
      linkEntityRef.current = null
      linkColorRef.current = null
      const viewer = viewerRef.current
      viewerRef.current = null
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
    }
  }, [])

  // --- Animation loop: propagate and move markers -------------------------
  useEffect(() => {
    let frame = 0
    let lastPush = 0
    let lastTrackRefresh = 0
    const startedAtReal = performance.now()
    const simBase = new Date()

    /**
     * Which objects should be wearing an orbit ring, and how it is drawn.
     *
     * Colour carries risk, shape carries identity — the same rule CLAUDE.md
     * §5.2 imposes on object type. So both members of a conjunction share the
     * event's risk colour, and the SECONDARY is dashed to tell them apart.
     * An object selected on its own gets the accent colour, which is chrome
     * (selection), never a risk token.
     */
    const wantedTracks = () => {
      const wanted = new Map()
      const highlight = highlightRef.current

      if (highlight?.primaryId) {
        wanted.set(highlight.primaryId, { colorHex: highlight.colorHex, dashed: false })
      }
      if (highlight?.secondaryId && !wanted.has(highlight.secondaryId)) {
        wanted.set(highlight.secondaryId, { colorHex: highlight.colorHex, dashed: true })
      }

      const selected = selectedRef.current
      if (selected && !wanted.has(selected)) {
        wanted.set(selected, { colorHex: MARKER_SELECTED_HEX, dashed: false })
      }
      return wanted
    }

    /**
     * The flown and unflown arcs of a simulated burn.
     *
     * Both are drawn, and at this scale they are the SAME LINE: the burn moves
     * the trajectory a few hundred metres across an arc tens of thousands of
     * kilometres long. That is not a rendering failure, it is the physics, and
     * ManeuverPanel draws the encounter to scale where the difference is
     * actually visible. What the globe adds is context — which stretch of the
     * orbit runs from the burn to the encounter.
     *
     * The unflown arc keeps the event's risk colour, because it is still the
     * trajectory that carries the risk. The flown one is drawn in the accent:
     * a planned burn is a proposed action, which is chrome, not a threat level
     * (styles/tokens.css forbids mixing the two systems).
     *
     * Returns Cartesian3 arrays keyed like the orbit rings, so one upsert loop
     * serves both.
     */
    const wantedManeuverArcs = (simTime) => {
      const overlay = maneuverRef.current
      const tracks = overlay?.tracks
      const times = tracks?.sample_utc_iso
      if (!tracks || !Array.isArray(times) || times.length < 2) return new Map()

      const toCartesians = (rows) => {
        const aligned = alignTrackToInstant(rows, times, simTime)
        if (!aligned) return null
        return aligned.map((p) => new Cesium.Cartesian3(p.x * 1000, p.y * 1000, p.z * 1000))
      }

      const pre = toCartesians(tracks.pre_burn_pos_ecef_km)
      const post = toCartesians(tracks.post_burn_pos_ecef_km)
      if (!pre || !post) return new Map()

      const arcs = new Map()
      // Drawn first and wider, so the flown arc reads as sitting inside it.
      arcs.set('maneuver:pre', {
        colorHex: overlay.colorHex, dashed: false, width: 5, positions: pre,
      })
      arcs.set('maneuver:post', {
        colorHex: MARKER_SELECTED_HEX, dashed: false, width: 2, positions: post,
      })
      return arcs
    }

    const removeTrack = (viewer, id) => {
      const track = trackEntitiesRef.current.get(id)
      if (!track) return
      viewer.entities.remove(track.entity)
      trackEntitiesRef.current.delete(id)
    }

    /**
     * Draw one revolution of each wanted object's orbit.
     *
     * The ring is the marker's own path: lib/orbitTrack.js samples the same
     * element set with the same propagator and rotates every sample by the
     * instant's GMST, which is what puts the marker exactly on its ring. A null
     * from the sampler means that object has no usable element set, and it gets
     * NO ring — never a partial arc, which would read as an orbit that stops in
     * mid-air.
     *
     * Entities are created once and their geometry swapped through the holder a
     * CallbackProperty closes over, for the reason documented at the link line
     * below: reassigning `polyline.positions` invalidates the geometry every
     * frame and the primitive never finishes building, so the line silently
     * never draws.
     */
    const syncOrbitTracks = (viewer, simTime) => {
      const wanted = wantedTracks()
      for (const [key, arc] of wantedManeuverArcs(simTime)) wanted.set(key, arc)

      const tracks = trackEntitiesRef.current
      const sampler = orbitTrackForRef.current

      for (const [id, style] of wanted) {
        // A maneuver arc arrives with its geometry already built; an orbit ring
        // is sampled here from the object's own element set.
        let positions = style.positions
        if (!positions) {
          const points = sampler?.(id, simTime)
          if (!points || points.length < 2) {
            removeTrack(viewer, id)
            continue
          }
          // km from the physics-facing modules, metres for Cesium. Named
          // explicitly because a silent factor of 1000 here would draw a ring
          // inside the planet.
          positions = points.map(
            (p) => new Cesium.Cartesian3(p.x * 1000, p.y * 1000, p.z * 1000),
          )
        }
        if (positions.length < 2) {
          removeTrack(viewer, id)
          continue
        }

        const styleKey = `${style.colorHex}|${style.dashed}|${style.width ?? 1.8}`
        let track = tracks.get(id)
        if (track && track.styleKey !== styleKey) {
          // Solid and dashed are different material types, so a style change
          // rebuilds rather than mutates. It happens on selection, not per
          // frame, so there is nothing to optimise here.
          removeTrack(viewer, id)
          track = undefined
        }

        if (track) {
          track.holder.points = positions
          continue
        }

        const holder = { points: positions }
        const color = Cesium.Color.fromCssColorString(style.colorHex).withAlpha(TRACK_ALPHA)
        const behind = color.withAlpha(TRACK_DEPTH_FAIL_ALPHA)
        const material = style.dashed
          ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 14 })
          : new Cesium.ColorMaterialProperty(color)
        const depthFailMaterial = style.dashed
          ? new Cesium.PolylineDashMaterialProperty({ color: behind, dashLength: 14 })
          : new Cesium.ColorMaterialProperty(behind)

        const entity = viewer.entities.add({
          id: `orbit-track:${id}`,
          polyline: {
            positions: new Cesium.CallbackProperty(() => holder.points, false),
            width: style.width ?? 1.8,
            material,
            // Half of any orbit is behind the Earth. Without a depth-fail
            // material that half simply vanishes and the ring reads as an arc.
            depthFailMaterial,
            // Straight segments between points in space. Draping onto the
            // ellipsoid would turn an orbit into a ground track it is not.
            arcType: Cesium.ArcType.NONE,
          },
        })
        tracks.set(id, { entity, holder, styleKey })
      }

      for (const id of [...tracks.keys()]) {
        if (!wanted.has(id)) removeTrack(viewer, id)
      }
    }

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const viewer = viewerRef.current
      if (!viewer || viewer.isDestroyed()) return

      const elapsed = performance.now() - startedAtReal
      // A caller-supplied clock wins: the replay's window in 2004 is not
      // expressible as "now, sped up". Default stays the live behaviour.
      const simTime = simTimeForRef.current
        ? simTimeForRef.current(elapsed)
        : computeSimTime(simBase, elapsed, speedRef.current)
      const satellites = propagateRef.current?.(simTime) ?? []

      // Captured as the pair's markers are placed, so the connecting line
      // below is drawn from the very Cartesians the entities were given.
      let pairPrimaryPos = null
      let pairSecondaryPos = null

      for (const sat of satellites) {
        let entity = entitiesRef.current.get(sat.id)
        const position = Cesium.Cartesian3.fromDegrees(
          sat.longitude_deg,
          sat.latitude_deg,
          sat.altitude_km * 1000,
        )

        const kind = sat.kind ?? OBJECT_KIND.UNKNOWN

        if (!entity) {
          entity = viewer.entities.add({
            id: sat.id,
            position,
            // Billboard, not point: Cesium points are circles only, and the
            // whole purpose of the shape axis is telling a payload apart from
            // a debris fragment at a glance.
            billboard: {
              image: markerImage(kind, MARKER_DEFAULT_HEX),
              width: markerPixelSize(kind),
              height: markerPixelSize(kind),
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            },
            label: {
              text: sat.name,
              font: '500 11px Inter, system-ui, sans-serif',
              fillColor: Cesium.Color.fromCssColorString('#e4e4e7'),
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('rgba(5,5,5,0.65)'),
              backgroundPadding: new Cesium.Cartesian2(6, 4),
              pixelOffset: new Cesium.Cartesian2(12, 0),
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8.0e7),
              disableDepthTestDistance: 0,
              // Off by default; switched on below only for the few objects
              // worth naming. See LABELLED_ONLY.
              show: false,
            },
          })
          entitiesRef.current.set(sat.id, entity)
          // Remember what the marker currently looks like, so the styling
          // below can skip the work when nothing about it changed. Rebuilding
          // a billboard image for every object every frame is what makes a
          // few-hundred-object set stutter.
          entity.__markerKey = `${kind}|${MARKER_DEFAULT_HEX}|1`
        } else {
          entity.position = position
        }

        // A conjunction highlight takes precedence over the plain
        // tracked-object selection: while a risk pair is on screen, that is
        // the thing worth drawing attention to.
        const highlight = highlightRef.current
        const isPairMember =
          highlight && (sat.id === highlight.primaryId || sat.id === highlight.secondaryId)
        const isSelected = selectedRef.current === sat.id

        let colorHex = MARKER_DEFAULT_HEX
        let scale = 1
        if (isPairMember) {
          colorHex = highlight.colorHex
          scale = 1.7
          if (sat.id === highlight.primaryId) pairPrimaryPos = position
          else pairSecondaryPos = position
        } else if (isSelected) {
          colorHex = MARKER_SELECTED_HEX
          scale = 1.5
        }

        // Only touch the billboard when its appearance actually changed.
        const markerKey = `${kind}|${colorHex}|${scale}`
        if (entity.__markerKey !== markerKey) {
          entity.billboard.image = markerImage(kind, colorHex, scale)
          const px = markerPixelSize(kind, scale)
          entity.billboard.width = px
          entity.billboard.height = px
          entity.__markerKey = markerKey
        }

        // Name only what the viewer is being pointed at.
        const wantLabel = !LABELLED_ONLY || isPairMember || isSelected
        if (entity.label.show !== wantLabel) entity.label.show = wantLabel
      }

      // The connecting line between a selected conjunction's two objects.
      // Both endpoints were captured while placing the markers above, so the
      // line is exactly where the two markers are this frame — never a
      // separately propagated (and possibly drifting) pair of points.
      //
      // The endpoints go into a ref that a CallbackProperty reads, and the
      // entity is built ONCE. Reassigning `polyline.positions` every frame
      // instead looks like it should work and does not: each assignment
      // invalidates the geometry, Cesium rebuilds the primitive
      // asynchronously, and re-invalidating on the next frame means the build
      // never completes. The entity stays present and valid the whole time
      // and simply never draws. A CallbackProperty marked non-constant is the
      // supported path for geometry that moves every frame.
      const highlight = highlightRef.current

      if (pairPrimaryPos && pairSecondaryPos) {
        linkPositionsRef.current = [pairPrimaryPos, pairSecondaryPos]
        const color = Cesium.Color.fromCssColorString(highlight.colorHex)

        if (!linkEntityRef.current) {
          linkEntityRef.current = viewer.entities.add({
            polyline: {
              positions: new Cesium.CallbackProperty(() => linkPositionsRef.current, false),
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({
                color,
                dashLength: 12,
              }),
              // The two objects are frequently on opposite sides of the
              // planet, so the chord between them passes through it. Without
              // a depth-fail material that stretch is simply gone and the
              // pair reads as unconnected; drawing it faintly keeps the line
              // continuous while still reading as "behind the Earth".
              depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
                color: color.withAlpha(0.4),
                dashLength: 12,
              }),
              // A straight chord, not a great-circle arc: these are two
              // objects in space, and bending the line onto the ellipsoid
              // would draw a ground track that does not exist.
              arcType: Cesium.ArcType.NONE,
            },
          })
          linkColorRef.current = highlight.colorHex
        } else if (linkColorRef.current !== highlight.colorHex) {
          // Only on an actual change: assigning the material every frame has
          // the same invalidation problem as assigning the positions did.
          linkEntityRef.current.polyline.material.color = color
          linkEntityRef.current.polyline.depthFailMaterial.color = color.withAlpha(0.4)
          linkColorRef.current = highlight.colorHex
        }
      } else if (linkEntityRef.current) {
        viewer.entities.remove(linkEntityRef.current)
        linkEntityRef.current = null
        linkColorRef.current = null
      }

      const now = performance.now()

      // Orbit rings are re-sampled on their own, slower cadence: each one is
      // 129 SGP4 propagations, which is cheap four times a second and not
      // cheap sixty.
      if (now - lastTrackRefresh > TRACK_REFRESH_MS) {
        lastTrackRefresh = now
        syncOrbitTracks(viewer, simTime)
      }

      // Throttle React updates: the HUD only needs a few refreshes a second,
      // and pushing state every frame would re-render the whole console.
      if (now - lastPush > telemetryIntervalRef.current) {
        lastPush = now
        telemetryRef.current?.({ simTime, satellites })
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [satelliteCount, clockKey])

  return <div className="cesium-globe" ref={containerRef} />
}

export default CesiumGlobe
