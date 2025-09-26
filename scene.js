import * as THREE from "three";
import nipplejs from "nipplejs";

/* DOM refs */
const canvas = document.getElementById("illusion");
const aiBtn = document.getElementById("aiAlter");

/* Renderer */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

/* Scene + Camera */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d0f); // dim library ambiance
const camera = new THREE.PerspectiveCamera(65, canvas.clientWidth / canvas.clientHeight, 0.1, 2000);
camera.position.set(0, 1.6, 6);

/* Lights */
const hemi = new THREE.HemisphereLight(0xbcc7ff, 0x493a2a, 0.6);
scene.add(hemi);
const spot = new THREE.SpotLight(0xfff2d5, 0.9, 100, Math.PI / 5, 0.3, 0.5);
spot.position.set(0, 18, 0);
scene.add(spot);

/* Library Geometry: vast rotunda */
const rotundaRadius = 24;
const rotundaHeight = 18;

/* Floor */
const floorGeo = new THREE.CircleGeometry(rotundaRadius, 64);
const floorUniforms = {
  u_time: { value: 0 },
  u_drip: { value: 0 },
  u_tex: { value: new THREE.Texture() },
  u_center: { value: new THREE.Vector2(0.5, 0.5) }
};
const floorMat = new THREE.ShaderMaterial({
  uniforms: floorUniforms,
  transparent: false,
  vertexShader: `
    varying vec2 v_uv;
    void main(){
      v_uv = uv;
      vec4 p = modelViewMatrix * vec4(position,1.0);
      gl_Position = projectionMatrix * p;
    }
  `,
  fragmentShader: `
    precision mediump float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform float u_drip;
    uniform sampler2D u_tex;

    // marble base tones
    vec3 marble(vec2 uv){
      float veins = sin(uv.x*20.0)+cos(uv.y*24.0);
      float grain = fract(sin(dot(uv, vec2(12.9898,78.233))) * 43758.5453);
      float m = 0.65 + 0.08*veins + 0.05*grain;
      return vec3(0.92,0.9,0.88)*m;
    }

    void main(){
      vec2 uv = v_uv;
      vec3 base = marble(uv);

      // drip projection radial from center: simulate paint accumulation
      float dripPhase = u_drip;
      if(dripPhase > 0.0){
        // sample ceiling texture colors as "paint", biased vibrant
        vec3 paint = texture2D(u_tex, vec2(uv.x, 1.0 - uv.y)).rgb;
        paint = pow(paint, vec3(0.85)); // boost saturation
        // vertical streaks moving outward
        float r = length(uv - 0.5);
        float streak = smoothstep(0.3, 0.0, abs(sin((uv.x*50.0) + u_time*2.0)))*smoothstep(0.7, 0.2, r);
        float flow = smoothstep(0.0, 1.0, dripPhase) * streak;
        base = mix(base, paint, flow*0.65);
      }

      gl_FragColor = vec4(base, 1.0);
    }
  `
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

/* Walls: inner cylinder with muted shelves pattern */
const wallGeo = new THREE.CylinderGeometry(rotundaRadius, rotundaRadius, rotundaHeight, 72, 1, true);
const wallMat = new THREE.MeshStandardMaterial({
  color: 0x5a4d3b,
  roughness: 0.8,
  metalness: 0.0
});
const walls = new THREE.Mesh(wallGeo, wallMat);
walls.position.y = rotundaHeight / 2 - 0.01;
scene.add(walls);

/* Tall bookshelf rows (cannot see over) */
const shelfMat = new THREE.MeshStandardMaterial({ color: 0x4a3f32, roughness: 0.85 });
for (let x = -12; x <= 12; x += 6) {
  for (let z = -18; z <= 18; z += 12) {
    const geo = new THREE.BoxGeometry(14, 3.2, 1.2);
    const shelf = new THREE.Mesh(geo, shelfMat);
    shelf.position.set(x, 1.6, z);
    if (Math.hypot(shelf.position.x, shelf.position.z) < rotundaRadius - 2.0) scene.add(shelf);
  }
}

/* Ceiling: shallow dome with fresco shader */
const domeGeo = new THREE.SphereGeometry(rotundaRadius, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2);
const domeMat = new THREE.MeshStandardMaterial({ color: 0xd9cbb5, roughness: 0.9, metalness: 0.0 });
const dome = new THREE.Mesh(domeGeo, domeMat);
dome.position.y = rotundaHeight - 0.4;
scene.add(dome);

/* Movement: WASD + mouse look (pointer lock), clamp pitch */
let yaw = 0, pitch = 0;
const speed = 3.5;
let keys = {};
document.addEventListener("keydown", e => keys[e.code] = true);
document.addEventListener("keyup", e => keys[e.code] = false);

canvas.addEventListener("click", () => {
  canvas.requestPointerLock();
});
document.addEventListener("mousemove", e => {
  if (document.pointerLockElement === canvas) {
    const sensitivity = 0.0025;
    yaw -= e.movementX * sensitivity;
    pitch -= e.movementY * sensitivity;
    pitch = Math.max(-Math.PI*0.47, Math.min(Math.PI*0.47, pitch));
  }
});

/* Mobile joystick */
const joy = nipplejs.create({
  zone: document.body,
  mode: 'static',
  position: { left: '80px', bottom: '80px' },
  color: 'white',
  size: 90
});
let joyVec = { x:0, y:0 };
joy.on('move', (_, data) => {
  const r = data.vector;
  joyVec.x = r.x || 0;
  joyVec.y = r.y || 0;
});
joy.on('end', () => { joyVec.x = 0; joyVec.y = 0; });

/* AI: Generate ceiling fresco using provided prompt */
const frescoPrompt = `Ceiling fresco composed only of circular portrait medallions, clean aged plaster background, no books, no shelves, no library interior, no paint streaks, no dripping. Each medallion has a luminous gold rim framing a centered portrait: wizard (white beard), knight (crimson and emerald), dragon (teal and magenta), jewel-bright accents against muted earth tones. Symmetrical tileable layout of medallions across the ceiling, seamless texture, high-resolution, Free Flux Schnell style, photoreal fresco. Avoid text, lettering, architectural details, and any streaking or melting effects.`;

const medGroup = new THREE.Group();
scene.add(medGroup);

/* texture loader helper */
async function loadPortraits() {
  aiBtn.disabled = true;
  aiBtn.textContent = "Generating Portraits...";
  try {
    medGroup.clear();
    const subjects = [
      "circular gold-rim portrait, wizard with white beard, centered, neutral plaster background, no text, no extra elements, high detail",
      "circular gold-rim portrait, valiant knight in crimson and emerald, centered, neutral plaster background, no text",
      "circular gold-rim portrait, dragon teal and magenta, centered, neutral plaster background, no text",
      "circular gold-rim portrait, queen in muted earth tones with jewel accents, centered, neutral plaster background, no text",
      "circular gold-rim portrait, scholar with spectacles, centered, neutral plaster background, no text",
      "circular gold-rim portrait, archer in forest hues, centered, neutral plaster background, no text",
      "circular gold-rim portrait, mystic with hood, centered, neutral plaster background, no text",
      "circular gold-rim portrait, bard with lute, centered, neutral plaster background, no text"
    ];
    const textures = [];
    for (const s of subjects) {
      const r = await websim.imageGen({ prompt: s, aspect_ratio: "1:1", transparent: true });
      const tex = await new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { const t = new THREE.Texture(img); t.needsUpdate = true; res(t); };
        img.onerror = rej; img.src = r.url;
      });
      textures.push(tex);
    }
    placeMedallions(textures);
  } catch (e) { console.error(e); alert("Portrait generation failed."); }
  aiBtn.disabled = false;
  aiBtn.textContent = "Generate Portraits";
}

function placeMedallions(textures){
  const rings = [
    { phi: 0.12, count: 6, radius: rotundaRadius - 0.2 },
    { phi: 0.22, count: 10, radius: rotundaRadius - 0.2 }
  ];
  let ti = 0;
  const topY = dome.position.y - rotundaRadius;
  const center = new THREE.Mesh(new THREE.CircleGeometry(6.0, 96),
    new THREE.MeshBasicMaterial({ map: textures[0], transparent: true }));
  center.position.set(0, topY, 0);
  center.lookAt(0, center.position.y - 1, 0);
  medGroup.add(center);
  for (const ring of rings){
    for (let i=0;i<ring.count;i++){
      const theta = (i / ring.count) * Math.PI * 2;
      const r = ring.radius, phi = ring.phi;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = dome.position.y - r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(4.0, 64),
        new THREE.MeshBasicMaterial({ map: textures[ti % textures.length], transparent: true }));
      mesh.position.set(x,y,z);
      mesh.lookAt(0, y - 1, 0);
      medGroup.add(mesh);
      ti++;
    }
  }
}

/* Expose button to regenerate fresco */
aiBtn.addEventListener("click", loadPortraits);

/* Initial generate */
loadPortraits();

/* Animation loop */
let last = performance.now();
function animate(now){
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // movement
  const forward = (keys["KeyW"] ? 1:0) - (keys["KeyS"] ? 1:0) + (-joyVec.y);
  const strafe = (keys["KeyD"] ? 1:0) - (keys["KeyA"] ? 1:0) + (joyVec.x);
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const dirX = strafe * cosY + forward * sinY;
  const dirZ = strafe * -sinY + forward * cosY;
  camera.position.x += dirX * speed * dt;
  camera.position.z += dirZ * speed * dt;

  // keep inside rotunda
  const r = Math.hypot(camera.position.x, camera.position.z);
  if (r > rotundaRadius - 1.0) {
    const k = (rotundaRadius - 1.0) / r;
    camera.position.x *= k;
    camera.position.z *= k;
  }
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, 1.2, rotundaHeight - 1.0);

  // apply rotation
  camera.rotation.set(pitch, yaw, 0, "YXZ");

  // uniforms
  const t = now * 0.001;
  floorUniforms.u_time.value = t;

  // resize
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h){
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

/* Accessibility: basic instructions in console */
console.log("Explore with WASD + mouse (click canvas to capture). Move to center and look up to start the fresco churn & drip.");