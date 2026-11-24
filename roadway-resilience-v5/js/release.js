/* Explicit V5 publication context and integrity policy. No scientific calculations. */
(function(root){
  "use strict";
  const ORIGIN="https://framerstoev.github.io", PATH="/SPTC/roadway-resilience-v5/", EXPECTED={"bytes": 1180875, "sha256": "cd6044f55957526c2024877ccd3a9361e2b24817598571fbc046cf928ee68da6"};
  let policy=null,pending=null;
  function allowed(value){const url=new URL(value);return (url.origin===ORIGIN||V4Data.localHost(url.hostname))&&new URL(".",url).pathname===PATH;}
  async function authorize(event){
    if(!allowed(location.href))throw Error("V5 is outside its authorized publication origin or base path");
    if(!pending)pending=V4Data.json("./data/v5-release.json?v=v5-b7026cd65f0b",document.baseURI,EXPECTED).then(p=>{
      if(p.schema_version!==1||p.mode!=="PUBLIC_ANALYTICAL"||p.public_origin!==ORIGIN||p.base_path!==PATH||p.authorization?.reference!=="8ff5010f-f105-4b16-ac16-2b033ebfa2d1"||p.authorization?.processed_CS_products_and_roadway_visualizations!==true||p.section_counts?.beryl_2024_07!==5763||p.section_counts?.coldwave_2026_01!==10029||p.curve_counts?.beryl_2024_07!==5698||p.curve_counts?.coldwave_2026_01!==3842||p.o1a_qualified!==3097||p.o1b_qualified!==943)throw Error("Invalid V5 public release policy");
      policy=p;return p;
    }).catch(error=>{pending=null;throw error;});
    const p=await pending;if(!p.event_ids.includes(event))throw Error("Event outside V5 release");return p;
  }
  function integrity(url){
    if(!policy)return null;
    if(!allowed(location.href)||url.origin!==location.origin)throw Error("Data outside V5 publication");
    const name=url.pathname.slice(PATH.length),record=policy.files[name];
    if(!url.pathname.startsWith(PATH)||!record)throw Error("Data absent from V5 public inventory");return record;
  }
  root.V4Release=Object.freeze({authorize,integrity,allowed});
})(window);
