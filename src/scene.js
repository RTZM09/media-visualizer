// Audio-reactive particle sphere: one uniform color, no connecting lines,
// rotating and pulsing with the music. Anchor points are scattered
// randomly around the sphere (regenerated each time the app loads), and
// each characteristic (bass/mid/treble) is randomly assigned to some of
// them. Rather than each point committing to a single "nearest" anchor
// (which creates a hard seam at the border between two regions), every
// point blends the weighted influence of ALL anchors — closer anchors
// dominate, distant ones fade out smoothly — so the sphere reads as one
// continuous, unitary surface even though each region's bump is still
// driven independently by its own characteristic. Point size stays fixed,
// only radial distance reacts.

import * as THREE from 'three';

// ============================================================================
// PRESET COLORS — pick one of these for SPHERE_COLOR below (index.html has
// a matching palette for the now-playing box's color — keep them in sync
// by hand, since CSS can't read these JS values directly). Add your own
// hex values here too if you want something outside this set.
// ============================================================================
const COLOR_RED = 0xff2b44;
const COLOR_PINK = 0xff6688;
const COLOR_CYAN = 0x66eeff;
const COLOR_PURPLE = 0xaa66ff;
const COLOR_GREEN = 0x5affa0;
const COLOR_ORANGE = 0xff9d4d;
const COLOR_GOLD = 0xffd166;

// ============================================================================
// TUNABLES — everything that changes how the sphere looks and behaves lives
// here. The code below this section just reads these values; you shouldn't
// need to touch anything past "IMPLEMENTATION" for a look/feel change.
// ============================================================================

// --- Overall size & shape --------------------------------------------------
const SPHERE_RADIUS = 1.6; // base radius of the sphere the points sit on
const CAMERA_DISTANCE = 9; // how far back the camera sits — bigger number = sphere reads smaller on screen
const POINT_COUNT = 1800; // how many dots make up the sphere
const BASE_POINT_SIZE = 0.035; // fixed size of each dot (world units) — does NOT react to audio
const SPHERE_COLOR = COLOR_PURPLE; // <- change to any COLOR_* preset above (or your own hex)
const POINT_OPACITY = 0.9; // flat opacity for every dot
// No background — the window itself is transparent (see electron/main.cjs)
// so the sphere floats directly over the desktop.

// How quickly the sphere eases toward a new vertical position when it
// needs to reframe itself (e.g. the now-playing box appearing/disappearing
// — see setVerticalTarget()). Lower = slower/smoother, higher = snappier.
const VERTICAL_REPOSITION_SMOOTHING = 0.08;

// --- Regions -----------------------------------------------------------
const ANCHOR_COUNT = 12; // how many independent regions the sphere is split into
// Minimum angle (radians) enforced between randomly-placed anchors so they
// scatter around the sphere instead of risking two landing on top of each
// other. (Best possible even spacing for 12 points is ~63°, so this stays
// comfortably below that to keep the random placement reliable.)
const MIN_ANCHOR_SEPARATION = (36 * Math.PI) / 180;
// How many of the ANCHOR_COUNT regions get assigned to each characteristic.
// Must add up to ANCHOR_COUNT.
const ANCHORS_PER_CHARACTERISTIC = { bass: 4, mid: 4, treble: 4 };
// How far each characteristic pushes its regions' points outward from the
// sphere's center, in world units, at full energy.
const ZONE_DISPLACEMENT = { bass: 0.78, mid: 0.48, treble: 0.3 };

// --- Region blending ---------------------------------------------------
// Shapes the per-anchor weighting kernel used for the blend — this does
// double duty as both "how sharply a region's bump peaks at its anchor"
// AND "how localized vs. blended-into-its-neighbors that anchor's
// influence is". Higher = more distinct regions with sharper edges (closer
// to a hard-border look). Lower = softer, more overlapping, more "one
// unitary sphere".
const FALLOFF_EXPONENT = 4;
// Multiplies the blended result — this is what makes the peaks reach
// further, independent of how blended/soft the transitions are (above).
const FALLOFF_GAIN = 2.4;

// --- Beat reaction -------------------------------------------------------
// How much of a beat's punch gets added into a region's displacement,
// relative to its normal energy-driven displacement.
const BEAT_DISPLACEMENT_AMOUNT = 0.25;
// Non-bass regions only feel this fraction of a beat's punch (bass regions
// feel it in full) — beats read most naturally as a bass-region effect.
const BEAT_NON_BASS_FACTOR = 0.25;
const BEAT_PUNCH_DECAY = 0.15; // how fast the beat punch fades out each frame — closer to 1 = lingers longer
const CAMERA_FOV_PUNCH = 3.5; // how much a beat punch briefly narrows the camera's field of view

// --- Motion smoothing ("filters") ---------------------------------------
// Separate attack (rising toward a louder target) vs release (falling back
// down) smoothing for the points' target displacement — a plain symmetric
// lerp still looks snappy on sudden loud hits, because a bigger jump means
// a bigger first step even at a "slow" rate. Lower = smoother/slower,
// higher = snappier/closer to raw per-frame audio (jumpier).
const POINT_ATTACK_SMOOTHING = 0.025; // rising toward a new, louder target
const POINT_RELEASE_SMOOTHING = 0.05; // falling back toward rest
// Separate (snappier) smoothing feeding rotation speed and overall scale.
const MOTION_SMOOTHING = { mid: 0.55, treble: 0.65 };

// --- Rotation ------------------------------------------------------------
const ROTATION_Y = { base: 0.12, treble: 1.0 }; // spin around Y: idle speed + how much treble speeds it up
const ROTATION_X = { base: 0.04, mid: 0.3 }; // tilt around X: idle speed + how much mid speeds it up

// --- Overall scale pulse ---------------------------------------------------
const SCALE_MID_AMOUNT = 0.3; // how much mids grow the whole sphere
const SCALE_PUNCH_AMOUNT = 0.3; // how much a beat punch grows the whole sphere
const SCALE_SMOOTHING = 0.85; // how quickly the sphere's actual scale eases toward its target (higher = snappier)

// --- Ambient shimmer (not audio-reactive, just a bit of idle life) -------
const TWINKLE_SPEED = 1.8;
const TWINKLE_SIZE_AMOUNT = 0.004;

// ============================================================================
// IMPLEMENTATION
// ============================================================================

const ZONE_BASS = 0;
const ZONE_MID = 1;
const ZONE_TREBLE = 2;

function randomSpherePoint() {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
}

function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `count` random points on the sphere, rejecting candidates too close to ones already placed. */
function randomSeparatedAnchors(count, minSeparation) {
  const anchors = [];
  const minDot = Math.cos(minSeparation);
  let attempts = 0;
  while (anchors.length < count && attempts < 2000) {
    attempts++;
    const candidate = randomSpherePoint();
    if (anchors.some((a) => a.dot(candidate) > minDot)) continue;
    anchors.push(candidate);
  }
  while (anchors.length < count) anchors.push(randomSpherePoint()); // fallback if packing failed
  return anchors;
}

// Randomly-scattered anchor points (regenerated each time the app loads),
// each the center of gravity of its own patch.
const ZONE_ANCHORS = randomSeparatedAnchors(ANCHOR_COUNT, MIN_ANCHOR_SEPARATION);

// Randomly assign each characteristic to its configured number of anchors.
const ANCHOR_ZONE = shuffled([
  ...Array(ANCHORS_PER_CHARACTERISTIC.bass).fill(ZONE_BASS),
  ...Array(ANCHORS_PER_CHARACTERISTIC.mid).fill(ZONE_MID),
  ...Array(ANCHORS_PER_CHARACTERISTIC.treble).fill(ZONE_TREBLE),
]);

function smoothTowards(current, target, attackRate, releaseRate) {
  return THREE.MathUtils.lerp(current, target, target > current ? attackRate : releaseRate);
}

const POINT_VERTEX_SHADER = /* glsl */ `
  attribute float aSeed;

  uniform vec3 uAnchors[${ANCHOR_COUNT}];
  uniform float uAnchorZone[${ANCHOR_COUNT}];

  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uBeatPunch;
  uniform float uTime;
  uniform float uSizeScale; // real canvas-height-based attenuation, matches PointsMaterial's own formula
  uniform float uBaseSize;
  uniform float uDispBass;
  uniform float uDispMid;
  uniform float uDispTreble;
  uniform float uFalloffExponent;
  uniform float uFalloffGain;
  uniform float uBeatDisplacementAmount;
  uniform float uBeatNonBassFactor;
  uniform float uTwinkleSpeed;
  uniform float uTwinkleSizeAmount;

  void main() {
    vec3 dir = normalize(position);

    // Weighted blend across every anchor instead of picking one "winner"
    // — this is what removes the hard seam at each patch's border.
    float totalWeight = 0.0;
    float blended = 0.0;
    for (int i = 0; i < ${ANCHOR_COUNT}; i++) {
      float d = max(dot(dir, uAnchors[i]), 0.0);
      float w = pow(d, uFalloffExponent);

      float zone = uAnchorZone[i];
      float energy = zone < 0.5 ? uBass : (zone < 1.5 ? uMid : uTreble);
      float dispAmount = zone < 0.5 ? uDispBass : (zone < 1.5 ? uDispMid : uDispTreble);
      float beatBoost = zone < 0.5 ? uBeatPunch : uBeatPunch * uBeatNonBassFactor;

      blended += w * (energy * dispAmount + beatBoost * uBeatDisplacementAmount);
      totalWeight += w;
    }
    blended = (blended / max(totalWeight, 0.0001)) * uFalloffGain;

    vec3 displaced = position + dir * blended;

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    float twinkle = 0.5 + 0.5 * sin(uTime * uTwinkleSpeed + aSeed * 6.2831);
    float size = uBaseSize + twinkle * uTwinkleSizeAmount;
    gl_PointSize = size * (uSizeScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Plain flat square dot — this is what THREE.PointsMaterial itself renders
// by default (no map/sprite texture = a filled square, not a circle).
const POINT_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

/** Evenly distributes `n` points over a sphere surface via the Fibonacci-sphere method. */
function fibonacciSphere(n, radius) {
  const positions = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2; // -1..1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;
    seeds[i] = Math.random();
  }
  return { positions, seeds };
}

export class Scene {
  constructor(container) {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.z = CAMERA_DISTANCE;
    this._baseFov = this.camera.fov;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 0); // fully transparent — the desktop shows through
    container.appendChild(this.renderer.domElement);

    this._group = new THREE.Group();
    this.scene.add(this._group);

    this._buildPointSphere();

    this._clock = new THREE.Clock();
    this._time = 0;
    this._punch = 0; // decays each frame, driven by beats
    this._smoothMid = 0;
    this._smoothTreble = 0;
    this._currentScale = 1;

    // Separate, slower-smoothed values feeding only the points' target
    // displacement (uBass/uMid/uTreble) — decoupled from _smoothMid/
    // _smoothTreble above, which stay snappier for rotation speed and
    // overall scale.
    this._targetBass = 0;
    this._targetMid = 0;
    this._targetTreble = 0;

    // Vertical framing: eases _group.position.y toward wherever
    // setVerticalTarget() last pointed it (see that method + update()).
    this._targetGroupY = 0;
    this._currentGroupY = 0;

    window.addEventListener('resize', () => this._onResize());
  }

  /**
   * Points the sphere at a given viewport Y (in CSS pixels, 0 = top of
   * window) — it eases there smoothly rather than snapping. Call every
   * frame with wherever the sphere should currently be centered; e.g. the
   * midpoint between the window's top and the now-playing box's top when
   * that box is showing, or window.innerHeight / 2 when it isn't.
   */
  setVerticalTarget(viewportY) {
    const ndcY = 1 - (viewportY / window.innerHeight) * 2;
    const near = new THREE.Vector3(0, ndcY, -1).unproject(this.camera);
    const far = new THREE.Vector3(0, ndcY, 1).unproject(this.camera);
    const dir = far.sub(near).normalize();
    // Intersect that screen ray with the world z=0 plane — the sphere's
    // own depth before any rotation/displacement moves individual points.
    const t = (0 - near.z) / dir.z;
    this._targetGroupY = near.y + dir.y * t;
  }

  _buildPointSphere() {
    const { positions, seeds } = fibonacciSphere(POINT_COUNT, SPHERE_RADIUS);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this._uniforms = {
      uAnchors: { value: ZONE_ANCHORS },
      uAnchorZone: { value: ANCHOR_ZONE },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uBeatPunch: { value: 0 },
      uTime: { value: 0 },
      // Drawing-buffer height (CSS height * pixel ratio), same quantity
      // THREE.PointsMaterial uses internally for its size attenuation.
      uSizeScale: { value: this.renderer.domElement.height * 0.5 },
      uBaseSize: { value: BASE_POINT_SIZE },
      uDispBass: { value: ZONE_DISPLACEMENT.bass },
      uDispMid: { value: ZONE_DISPLACEMENT.mid },
      uDispTreble: { value: ZONE_DISPLACEMENT.treble },
      uFalloffExponent: { value: FALLOFF_EXPONENT },
      uFalloffGain: { value: FALLOFF_GAIN },
      uBeatDisplacementAmount: { value: BEAT_DISPLACEMENT_AMOUNT },
      uBeatNonBassFactor: { value: BEAT_NON_BASS_FACTOR },
      uTwinkleSpeed: { value: TWINKLE_SPEED },
      uTwinkleSizeAmount: { value: TWINKLE_SIZE_AMOUNT },
      uColor: { value: new THREE.Color(SPHERE_COLOR) },
      uOpacity: { value: POINT_OPACITY },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this._uniforms,
      vertexShader: POINT_VERTEX_SHADER,
      fragmentShader: POINT_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, material);
    this._group.add(this.points);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this._uniforms.uSizeScale.value = this.renderer.domElement.height * 0.5;
  }

  /**
   * Whether a click/hover at these viewport coordinates lands on the
   * sphere. Tests against a plain bounding sphere (radius padded a bit
   * past the current scale, to comfortably cover the audio-driven bulges)
   * rather than raycasting the 3100 individual points — cheap and exact
   * enough for a click target.
   */
  hitTestSphere(clientX, clientY) {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster ??= new THREE.Raycaster();
    this._raycaster.setFromCamera(ndc, this.camera);

    const boundingRadius = SPHERE_RADIUS * this._currentScale * 1.4;
    const sphere = new THREE.Sphere(new THREE.Vector3(0, this._currentGroupY, 0), boundingRadius);
    return this._raycaster.ray.intersectSphere(sphere, new THREE.Vector3()) !== null;
  }

  /** Instant visual "hit" feedback (same kick a beat gives), independent of how long an async action triggered by it takes. */
  pulse() {
    this._punch = 1;
  }

  /** Call once per frame with the latest AudioEngine features. */
  update(features) {
    const dt = this._clock.getDelta();
    this._time += dt;
    const { bass, mid, treble, beat } = features;

    // Smooth the raw per-frame audio values so rotation/scale ease toward
    // their target instead of jittering with every noisy frame.
    this._smoothMid = THREE.MathUtils.lerp(this._smoothMid, mid, MOTION_SMOOTHING.mid);
    this._smoothTreble = THREE.MathUtils.lerp(this._smoothTreble, treble, MOTION_SMOOTHING.treble);

    // Separately (and more smoothly, with different attack/release rates),
    // just for where the points ease toward.
    this._targetBass = smoothTowards(this._targetBass, bass, POINT_ATTACK_SMOOTHING, POINT_RELEASE_SMOOTHING);
    this._targetMid = smoothTowards(this._targetMid, mid, POINT_ATTACK_SMOOTHING, POINT_RELEASE_SMOOTHING);
    this._targetTreble = smoothTowards(this._targetTreble, treble, POINT_ATTACK_SMOOTHING, POINT_RELEASE_SMOOTHING);

    this._group.rotation.y += dt * (ROTATION_Y.base + this._smoothTreble * ROTATION_Y.treble);
    this._group.rotation.x += dt * (ROTATION_X.base + this._smoothMid * ROTATION_X.mid);

    if (beat) this._punch = 1;
    this._punch *= BEAT_PUNCH_DECAY;

    const targetScale = 1.0 + this._smoothMid * SCALE_MID_AMOUNT + this._punch * SCALE_PUNCH_AMOUNT;
    this._currentScale = THREE.MathUtils.lerp(this._currentScale, targetScale, SCALE_SMOOTHING);
    this._group.scale.setScalar(this._currentScale);

    this._currentGroupY = THREE.MathUtils.lerp(this._currentGroupY, this._targetGroupY, VERTICAL_REPOSITION_SMOOTHING);
    this._group.position.y = this._currentGroupY;

    this.camera.fov = this._baseFov - this._punch * CAMERA_FOV_PUNCH;
    this.camera.updateProjectionMatrix();

    this._uniforms.uBass.value = this._targetBass;
    this._uniforms.uMid.value = this._targetMid;
    this._uniforms.uTreble.value = this._targetTreble;
    this._uniforms.uBeatPunch.value = this._punch;
    this._uniforms.uTime.value = this._time;

    this.renderer.render(this.scene, this.camera);
  }
}
