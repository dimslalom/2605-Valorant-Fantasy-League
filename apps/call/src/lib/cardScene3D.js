import { AmbientLight, BackSide, CanvasTexture, DirectionalLight, DoubleSide, FrontSide, Group, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { toCanvas } from 'html-to-image';
import { curlPoint } from './cardCurl';

export async function captureCard(node) {
  // Offscreen portraits must load before the DOM is baked into the texture.
  await Promise.all([...node.querySelectorAll('img')].map(img => { img.loading = 'eager'; return img.decode().catch(() => {}); }));
  await document.fonts.ready;
  return toCanvas(node, { width: 400, height: 580, pixelRatio: 2, preferredFontFormat: 'woff2' });
}

export function createCardScene(host, front, back, reducedMotion, onContextLost, hasNext) {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  host.append(renderer.domElement);
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 30);
  camera.position.z = 5;
  scene.add(new AmbientLight(0xffffff, 1.7));
  const light = new DirectionalLight(0xfff2e4, 2.8);
  light.position.set(-2, 3, 5);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -1.2, right: 1.2, top: 1.3, bottom: -1.3, near: 0.1, far: 12 });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.normalBias = 0.002;
  light.shadow.bias = -0.0001;
  light.shadow.intensity = 0.85;
  scene.add(light);
  const fill = new DirectionalLight(0xc9d9ff, 1.2);
  fill.position.set(2, 1, -4);
  scene.add(fill);
  const geometry = new PlaneGeometry(1, 1.45, 64, 12);
  const original = geometry.attributes.position.array.slice();
  const textures = [back, front].map((canvas, index) => {
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    // The printed front is viewed from the underside of the same sheet.
    if (index === 1) { texture.repeat.x = -1; texture.offset.x = 1; }
    return texture;
  });
  const materials = textures.map((map, index) => new MeshStandardMaterial({ map, side: index ? BackSide : FrontSide, transparent: true, alphaTest: 0.04, roughness: 0.55, metalness: 0.12, shadowSide: DoubleSide }));
  const card = new Group();
  materials.forEach(material => {
    const face = new Mesh(geometry, material);
    face.castShadow = true;
    face.receiveShadow = true;
    card.add(face);
  });
  scene.add(card);
  // The next card is real geometry too: the curl casts onto its printed back.
  // Match the first DOM stack offset (4px, 5px and 1.5deg at 220px width).
  const receiverGeometry = new PlaneGeometry(1, 1.45);
  const receiver = new Mesh(receiverGeometry, materials[0]);
  receiver.position.set(4 / 220, -5 / 220, -0.035);
  receiver.rotation.z = -1.5 * Math.PI / 180;
  receiver.receiveShadow = true;
  receiver.visible = hasNext;
  scene.add(receiver);
  let frame = 0, previous = 0, curl = 0, targetCurl = 0, rotation = 0, targetRotation = 0, side = 1, disposed = false;
  function draw(time) {
    frame = 0;
    const dt = Math.min((time - previous) / 1000 || 1 / 60, 0.05);
    previous = time;
    const blend = reducedMotion ? 1 : 1 - Math.exp(-18 * dt);
    curl += (targetCurl - curl) * blend;
    rotation += (targetRotation - rotation) * blend;
    if (Math.abs(curl - targetCurl) < 0.0001) curl = targetCurl;
    if (Math.abs(rotation - targetRotation) < 0.0001) rotation = targetRotation;
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const [x, z] = curlPoint(original[i * 3], curl, side);
      positions.setXYZ(i, x, original[i * 3 + 1], z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    card.rotation.y = rotation;
    // Lift clear of the stack while turning so neither half cuts through it.
    card.position.z = Math.sin(Math.abs(rotation)) * 0.58;
    renderer.render(scene, camera);
    if (curl !== targetCurl || rotation !== targetRotation) requestDraw();
  }
  function requestDraw() { if (!frame && !disposed) frame = requestAnimationFrame(draw); }
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const cardWidth = width / 1.5;
    receiver.position.set(4 / cardWidth, -5 / cardWidth, -0.035);
    camera.aspect = width / height;
    // Canvas has 25% padding on each side; card remains the DOM card's size.
    camera.fov = 2 * Math.atan(2.175 / (2 * camera.position.z)) * 180 / Math.PI;
    camera.updateProjectionMatrix();
    requestDraw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  resize();
  return {
    peek(progress, edge) { targetCurl = progress; if (progress) side = edge; requestDraw(); },
    reveal(up) { targetCurl = 0; targetRotation = up ? -side * Math.PI : 0; requestDraw(); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      geometry.dispose();
      receiverGeometry.dispose();
      light.shadow.dispose();
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
