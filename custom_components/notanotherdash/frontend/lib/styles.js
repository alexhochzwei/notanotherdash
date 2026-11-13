// Gestaltung nach dem abgestimmten Mockup. Ziel: Safari 15 (iPad Air 2) – kein @container, kein :has().
export const TINTS = { plum: "#5a2f3c", blue: "#2f3f5a", green: "#3c4a35", amber: "#4a3a28" };

export const CSS = `
:host{display:block;height:100%;
  --bg:#1b1619;--ink:#f5eee9;--ink2:rgba(245,238,233,.66);--ink3:rgba(245,238,233,.5);
  --surface:rgba(255,255,255,.055);--line:rgba(255,255,255,.08);
  --light:#f2a65a;--heat:#ff8f5c;--alert:#a9c6ff;
  font-family:'Outfit',-apple-system,'Segoe UI',sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
button,select{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
.ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.root{position:relative;height:100%;min-height:100vh;overflow:hidden;background:var(--bg);display:flex;flex-direction:column}
/* Lichtschein als Verlauf statt filter:blur – blur erzeugt in WebKit rechteckige Kanten. */
.glow{position:absolute;left:-200px;top:-260px;width:760px;height:620px;opacity:.55;pointer-events:none}
.lite .glow{opacity:.35}
.lbl{font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:rgba(245,238,233,.6)}

header{position:relative;display:flex;align-items:flex-end;gap:24px;padding:22px 24px 0;flex:none}
.clock{font-size:46px;font-weight:300;letter-spacing:-.01em;line-height:1;font-variant-numeric:tabular-nums;margin-top:4px}
.weather{display:flex;align-items:center;gap:10px;padding-bottom:4px;color:rgba(245,238,233,.8)}
.weather .ic{width:26px;height:26px}
.weather .t{font-size:20px;font-weight:500}
.weather .s{font-size:12.5px;color:rgba(245,238,233,.62)}
.chips{margin-left:auto;display:flex;gap:8px;padding-bottom:2px}
.chip{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px 0 12px;border-radius:19px;background:rgba(255,255,255,.06);border:1px solid var(--line);font-size:14px;font-weight:500}
.chip small{font-size:13px;font-weight:400;color:rgba(245,238,233,.62)}

.body{position:relative;flex:1;min-height:0;display:flex;gap:20px;padding:20px 24px 100px 20px}
.side{width:264px;flex:none;padding:22px 20px;border-radius:30px;background:linear-gradient(170deg,rgba(255,255,255,.08),rgba(40,33,37,.55) 55%);border:1px solid var(--line);display:flex;flex-direction:column;gap:18px;overflow:hidden}
.sep{height:1px;background:var(--line);flex:none}
.rem{display:flex;align-items:center;gap:10px}
.rem .badge{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;flex:none;background:rgba(255,255,255,.08);color:rgba(245,238,233,.8)}
.rem.soon .badge{background:rgba(250,204,21,.18);color:#fadb6a}
.rem .ic{width:16px;height:16px}
.rem .t{font-size:14.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rem .s{margin-left:auto;font-size:13px;color:rgba(245,238,233,.62);white-space:nowrap}
.stop{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500}
.stop .ic{color:rgba(245,238,233,.6)}
.dep{display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:10px;font-size:14px;font-variant-numeric:tabular-nums}
.line{height:24px;border-radius:7px;display:grid;place-items:center;font-size:12.5px;font-weight:600;color:#141012;background:var(--light);overflow:hidden;padding:0 3px;white-space:nowrap}
.dep .to{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(245,238,233,.85)}
.dep .min{font-weight:500}
.dep .late{color:#ffb08a}
.empty{font-size:13px;color:var(--ink3)}

.rooms{flex:1;min-width:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:16px;padding-bottom:8px}
.floor{display:flex;flex-direction:column;gap:10px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.tile{position:relative;display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;height:108px;padding:15px 16px 13px;border-radius:28px;background:var(--surface);border:1px solid var(--line);text-align:left;cursor:pointer;transition:transform .12s ease}
.tile:active{transform:scale(.97)}
.tile.on{background:linear-gradient(160deg,rgba(242,166,90,.16),rgba(255,255,255,.05) 60%);border-color:rgba(242,166,90,.28)}
.tname{font-size:18px;font-weight:500;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsub{font-size:13.5px;color:var(--ink2);font-variant-numeric:tabular-nums;margin-top:2px;min-height:17px}
.pills{display:flex;gap:5px;flex-wrap:nowrap;overflow:hidden}
.pill{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px 0 6px;border-radius:13px;background:rgba(255,255,255,.07);font-size:12.5px;font-weight:500;color:rgba(245,238,233,.8);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.pill .ic{width:15px;height:15px}
.pill.light{background:rgba(242,166,90,.18);color:#f6c48f}
.pill.heat{background:rgba(255,130,80,.16);color:#ffa47d}
.pill.alert{background:rgba(120,170,255,.16);color:var(--alert)}

nav.dock{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:4px;padding:6px;border-radius:26px;background:rgba(40,33,37,.92);border:1px solid rgba(255,255,255,.09);box-shadow:0 10px 30px rgba(0,0,0,.35)}
.lite nav.dock{box-shadow:none}
.dockbtn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:74px;height:54px;border:0;border-radius:18px;background:none;color:rgba(245,238,233,.62);font-size:12px;font-weight:500;cursor:pointer}
.dockbtn.act{background:rgba(255,255,255,.1);color:var(--ink)}
.dockbtn .ic{width:21px;height:21px}

.gear{position:absolute;right:24px;bottom:22px;width:56px;height:56px;border-radius:50%;background:none;border:0;color:rgba(245,238,233,.32);display:grid;place-items:center;cursor:pointer;padding:0;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.gear .gic{width:22px;height:22px}
.gear .ring{position:absolute;left:-1px;top:-1px;width:58px;height:58px;transform:rotate(-90deg);pointer-events:none}
.gear .ring circle{fill:none;stroke:var(--ink);stroke-width:2.5;stroke-dasharray:170;stroke-dashoffset:170}
.gear.press .ring circle{stroke-dashoffset:0;transition:stroke-dashoffset .6s linear}

.toast{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);padding:11px 18px;border-radius:16px;background:var(--ink);color:#1b1619;font-size:14px;font-weight:500;box-shadow:0 10px 30px rgba(0,0,0,.4);white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .2s}
.toast.show{opacity:1}

.settings{position:absolute;inset:0;background:var(--bg);display:none;z-index:5}
.settings.open{display:block}
.settings header{align-items:center;padding:22px 24px 0;height:70px}
.settings h1{margin:0;font-size:26px;font-weight:500}
.done{margin-left:auto;height:44px;padding:0 20px;border-radius:22px;border:0;background:var(--ink);color:#1b1619;font-size:15px;font-weight:600;cursor:pointer}
.snav{position:absolute;left:24px;top:94px;width:236px;display:flex;flex-direction:column;gap:4px}
.nav{display:flex;align-items:center;height:52px;padding:0 16px;border-radius:18px;border:0;background:none;text-align:left;font-size:15.5px;font-weight:500;color:rgba(245,238,233,.7);cursor:pointer}
.nav.on{background:rgba(255,255,255,.1);color:var(--ink)}
.spage{position:absolute;left:284px;right:24px;top:94px;bottom:24px;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:14px}
.note{font-size:13px;color:rgba(245,238,233,.6);padding:0 4px}
.group{border-radius:22px;background:rgba(255,255,255,.05);border:1px solid var(--line);overflow:hidden;flex:none}
.row{display:flex;align-items:center;gap:14px;min-height:60px;padding:8px 18px;border-bottom:1px solid rgba(255,255,255,.07)}
.row:last-child{border-bottom:0}
.row .t{font-size:15px;font-weight:500}
.row .d{font-size:12.5px;color:rgba(245,238,233,.6);margin-top:2px}
.sw{position:relative;width:52px;height:32px;border-radius:16px;border:0;background:rgba(255,255,255,.14);cursor:pointer;flex:none;margin-left:auto;transition:background .2s}
.sw:after{content:"";position:absolute;left:3px;top:3px;width:26px;height:26px;border-radius:50%;background:var(--ink);transition:transform .2s}
.sw.on{background:#5ec8a8}
.sw.on:after{transform:translateX(20px)}
select.ent{margin-left:auto;max-width:340px;height:38px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.15);font-size:13.5px;color:rgba(245,238,233,.9)}
.seg{margin-left:auto;display:flex;gap:4px;padding:4px;border-radius:14px;background:rgba(0,0,0,.18)}
.seg button{height:32px;padding:0 12px;border-radius:10px;border:0;background:none;font-size:13px;font-weight:500;color:rgba(245,238,233,.7);cursor:pointer}
.seg button.on{background:rgba(255,255,255,.14);color:var(--ink)}
.tint{width:34px;height:34px;border-radius:50%;border:2px solid transparent;cursor:pointer}
.tint.on{border-color:var(--ink)}
.lite *{transition:none!important}

/* ---------- Raumansicht ---------- */
.roomsheet{position:absolute;inset:0;display:none;z-index:4}
.roomsheet.open{display:block}
.backdrop{position:absolute;inset:0;background:rgba(10,8,9,.55)}
.sheet{position:absolute;left:24px;right:24px;top:22px;bottom:22px;padding:22px 24px 24px;border-radius:30px;background:#211b1e;border:1px solid rgba(255,255,255,.09);box-shadow:0 24px 60px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:18px;overflow:hidden}
.lite .sheet{box-shadow:none}
.shead{display:flex;align-items:center;gap:14px;flex:none}
.sname{font-size:28px;font-weight:500;letter-spacing:-.01em}
.ssub{font-size:14px;color:rgba(245,238,233,.62);font-variant-numeric:tabular-nums;margin-top:2px}
.scenes{margin-left:auto;display:flex;gap:8px;overflow:hidden}
.scene{height:40px;padding:0 16px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap}
.scene:active{transform:scale(.96)}
.round{width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.09);display:inline-grid;place-items:center;cursor:pointer;flex:none}
.round:active{transform:scale(.92)}
.round .ic{width:20px;height:20px}
.round.stop{background:var(--ink);color:#1b1619}
.sbody{flex:1;min-height:0;display:grid;grid-template-columns:276px minmax(0,1fr);gap:16px}
.sbody.noheat{grid-template-columns:minmax(0,1fr)}
.sright{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}

.card.heat{position:relative;overflow:hidden;padding:18px;display:flex;flex-direction:column;gap:12px;border-radius:22px;border:1px solid var(--line);background:linear-gradient(170deg,rgba(255,143,92,.14),rgba(40,33,37,.5) 55%)}
.heat > :not(.more):not(.graph){position:relative}
.graph{position:absolute;left:0;right:0;bottom:0;height:250px;pointer-events:none}
.graph svg{position:absolute;left:0;top:0;width:100%;height:100%}
.graph .axis{position:absolute;right:14px;bottom:8px;font-size:11px;color:rgba(245,238,233,.4)}
.more{position:absolute;right:10px;top:10px;width:32px;height:32px;border-radius:50%;border:0;background:rgba(0,0,0,.18);display:grid;place-items:center;cursor:pointer;color:rgba(245,238,233,.75);z-index:1}
.more .ic{width:16px;height:16px}
.target{display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:4px}
.tval{font-size:68px;font-weight:300;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tist{font-size:14px;color:rgba(245,238,233,.66);min-height:18px}
.hot{color:#ffb08a}
.isopen{color:var(--alert)}
.dialwrap{height:118px;margin:0 -18px -10px}
.dial{position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:none;padding:0;cursor:ew-resize;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-mask-image:linear-gradient(180deg,#000 55%,transparent 100%);mask-image:linear-gradient(180deg,#000 55%,transparent 100%)}
.dial svg{position:absolute;left:0;top:0;width:100%;height:100%}
.dialend{position:absolute;top:56px;width:44px;height:44px;border-radius:50%;border:0;background:none;display:grid;place-items:center;cursor:pointer;color:rgba(245,238,233,.75)}
.dialend:active{background:rgba(255,255,255,.08)}
.modes{display:flex;justify-content:center;gap:6px;flex-wrap:wrap}
.mode{height:34px;padding:0 12px;border-radius:17px;border:1px solid rgba(255,255,255,.1);background:none;font-size:13.5px;font-weight:500;cursor:pointer;color:rgba(245,238,233,.8)}
.mode.act{background:rgba(255,143,92,.2);border-color:rgba(255,143,92,.45);color:#ffb08a}
.rads{display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line)}
.srow{display:flex;align-items:center;gap:8px;font-size:13.5px;color:rgba(245,238,233,.78);font-variant-numeric:tabular-nums}
.srow .ic{width:17px;height:17px;color:rgba(245,238,233,.55)}
.srow .v{margin-left:auto}
.sensors{margin-top:auto;display:flex;gap:14px;flex-wrap:wrap}

.lights{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;flex:none}
.lt{position:relative;overflow:hidden;height:116px;border-radius:20px;border:1px solid var(--line);background:rgba(40,33,37,.55);text-align:left;padding:13px 14px;display:flex;flex-direction:column;justify-content:space-between;cursor:pointer;touch-action:none;-webkit-user-select:none;user-select:none}
.lt.on{border-color:rgba(242,166,90,.35)}
.lt .fill{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,rgba(242,166,90,.34),rgba(242,166,90,.18));pointer-events:none}
.lt .bulb{position:relative;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.08)}
.lt.on .bulb{background:var(--light);color:#2a1a0e}
.lt .ltx{position:relative;display:flex;flex-direction:column;gap:1px;min-width:0}
.lt .nm{font-size:15.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lt .st{font-size:13px;color:var(--ink2);font-variant-numeric:tabular-nums}

.covers{flex:1;min-height:250px;display:flex;gap:12px;overflow-x:auto}
.col{display:flex;flex-direction:column;gap:10px;padding:8px;border-radius:22px;background:rgba(40,33,37,.55);border:1px solid var(--line);width:116px;flex:none}
.col.grp{width:168px;border-color:rgba(143,179,255,.28)}
.vz{position:relative;overflow:hidden;flex:1;min-height:0;border-radius:16px;border:0;background:rgba(143,179,255,.10);padding:12px;text-align:left;display:flex;flex-direction:column;justify-content:flex-end;cursor:ns-resize;touch-action:none;-webkit-user-select:none;user-select:none}
.vz.fixed{cursor:pointer}
.vz .cover{position:absolute;left:0;right:0;top:0;background:repeating-linear-gradient(180deg,rgba(214,206,214,.30) 0 9px,rgba(214,206,214,.16) 9px 11px);border-bottom:2px solid rgba(245,238,233,.55);pointer-events:none}
.vz .ghost{position:absolute;left:8px;right:8px;height:3px;border-radius:2px;background:var(--ink);pointer-events:none}
.vz .nm{position:relative;font-size:14.5px;font-weight:500;line-height:1.2;-webkit-hyphens:auto;hyphens:auto;overflow-wrap:break-word}
.vz .st{position:relative;font-size:12.5px;color:rgba(245,238,233,.75);font-variant-numeric:tabular-nums;margin-top:2px}
.btnrow{display:flex;gap:6px}
.btnrow .round{flex:1;width:auto;border-radius:14px}
`;
