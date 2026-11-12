import * as THREE from 'three';

/** Graniglia e macchie sul cemento ai bordi della strada, in metri anche lungo i muri verticali. */
export function aggregatoTexture() {
  const size=128;
  const pixels=new Uint8Array(size*size*4);
  let seed=1879;
  for(let i=0;i<size*size;i++) {
    seed=(Math.imul(1664525,seed)+1013904223)>>>0;
    const v=(seed>>>24)/255;
    const value=Math.round(220+v*35-(v<0.07?38:0));
    pixels.set([value,value,value,255],i*4);
  }
  const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;
  texture.needsUpdate=true;
  return texture;
}
export function cemento(material: THREE.MeshLambertMaterial, texture:THREE.DataTexture) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uGrana={value:texture};
    shader.vertexShader='varying vec3 vBordo;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBordo = position;');
    shader.fragmentShader='varying vec3 vBordo; uniform sampler2D uGrana;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 n=abs(cross(dFdx(vBordo),dFdy(vBordo)));
      vec2 uv=n.y>max(n.x,n.z)?vBordo.xz:(n.x>n.z?vBordo.zy:vBordo.xy);
      float grain=texture2D(uGrana,uv/1.4).r;
      float stains=texture2D(uGrana,uv/22.0).r;
      diffuseColor.rgb*=0.32+0.48*grain+0.25*stains;
    `);
  };
  return material;
}

