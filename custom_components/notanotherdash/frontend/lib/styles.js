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
button.chip{color:inherit;font-family:inherit;cursor:pointer}
button.chip:active{transform:scale(.96)}
.chip small{font-size:13px;font-weight:400;color:rgba(245,238,233,.62)}

.body{position:relative;flex:1;min-height:0;display:flex;gap:20px;padding:20px 24px 100px 20px}
.side{width:264px;flex:none;padding:22px 20px;border-radius:30px;background:linear-gradient(170deg,rgba(255,255,255,.08),rgba(40,33,37,.55) 55%);border:1px solid var(--line);display:flex;flex-direction:column;gap:18px;overflow:hidden}
.sep{height:1px;background:var(--line);flex:none}
.waste{display:flex;flex-direction:column;gap:5px}
.rem{display:flex;align-items:center;gap:8px}
.rem .badge{width:24px;height:24px;border-radius:8px;display:grid;place-items:center;flex:none;background:rgba(255,255,255,.08);color:rgba(245,238,233,.8)}
.rem.soon .badge{background:rgba(250,204,21,.18);color:#fadb6a}
.rem .ic{width:14px;height:14px}
.rem .t{font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rem .s{margin-left:auto;font-size:13px;color:rgba(245,238,233,.62);white-space:nowrap}
.stop{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500}
.stop .ic{color:rgba(245,238,233,.6)}
.deps{display:flex;flex-direction:column;gap:6px}
.deps .stop{margin-bottom:2px}
.dep{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:9px;font-size:13.5px;line-height:1.2;font-variant-numeric:tabular-nums}
.line{height:20px;border-radius:6px;display:grid;place-items:center;font-size:12.5px;font-weight:600;color:#141012;background:var(--light);overflow:hidden;padding:0 3px;white-space:nowrap}
.dep .to{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(245,238,233,.85)}
.dep .min{font-weight:500}
.dep .late{color:#ffb08a}
.dep .min small{font-size:11px;font-weight:500}
.dep.gone .to,.dep.gone .line{opacity:.45;text-decoration:line-through}
.dep.gone .min{color:#ff8f8f}
.empty{font-size:13px;color:var(--ink3)}

.rooms{flex:1;min-width:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:16px;padding-bottom:8px}
.floor{display:flex;flex-direction:column;gap:10px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.tile{position:relative;display:flex;flex-direction:column;justify-content:space-between;align-items:stretch;height:108px;padding:15px 16px 13px;border-radius:28px;background:var(--surface);border:1px solid var(--line);text-align:left;cursor:pointer;transition:transform .12s ease}
.tile:active{transform:scale(.97)}
.tile.on{background:linear-gradient(160deg,rgba(242,166,90,.16),rgba(255,255,255,.05) 60%);border-color:rgba(242,166,90,.28)}
.tname{font-size:18px;font-weight:500;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsub{display:flex;align-items:center;font-size:13.5px;color:var(--ink2);font-variant-numeric:tabular-nums;margin-top:2px;min-height:17px;white-space:nowrap}
.tsub .tgt{color:var(--ink3)}
.ttemp.on,.ttemp.on .tgt{color:var(--heat)}
.tsub .dot{margin:0 5px}
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
.round{width:44px;height:44px;padding:0;line-height:0;border-radius:50%;border:0;background:rgba(255,255,255,.09);display:inline-grid;place-items:center;cursor:pointer;flex:none}
.round:active{transform:scale(.92)}
.round .ic{width:20px;height:20px}
.round.stop{background:var(--ink);color:#1b1619}
.sbody{flex:1;min-height:0;display:grid;grid-template-columns:276px minmax(0,1fr);gap:16px}
.sbody.noheat{grid-template-columns:minmax(0,1fr)}
.sright{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}

.card.heat{position:relative;overflow:hidden;align-self:start;padding:18px;display:flex;flex-direction:column;gap:12px;border-radius:22px;border:1px solid var(--line);background:linear-gradient(170deg,rgba(255,143,92,.14),rgba(40,33,37,.5) 55%)}
.heat > :not(.more):not(.graph){position:relative;flex:none}
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
.detail .sensors{margin-top:14px}

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

/* ---------- Panels (Energie, Sauger) ---------- */
.view{display:none;position:absolute;left:24px;right:24px;top:24px;bottom:96px;overflow-y:auto;-webkit-overflow-scrolling:touch}
.root.inview > header,.root.inview > .body{display:none}
.root.inview .view{display:block}
.view .card{position:relative;border-radius:30px;background:rgba(255,255,255,.05);border:1px solid var(--line);padding:16px 18px}
.ehint{max-width:560px;margin:80px auto;text-align:center;font-size:15px;line-height:1.5;color:var(--ink2)}
.ehint.small{margin:20px 0;text-align:left;font-size:13.5px}
.cap{font-size:12.5px;font-weight:500;color:rgba(245,238,233,.66)}
.ctitle{font-size:14px;font-weight:500}
.ekpis{display:flex;gap:14px}
.ekpis .kpi{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;min-height:112px}
.kpi .v,.efc .v{font-size:30px;font-weight:400;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1}
.kpi .v small,.efc .v small{font-size:15px;color:var(--ink2);margin-left:4px}
.eur{font-size:15px;color:var(--heat);font-variant-numeric:tabular-nums}
.eur small{font-size:12px;color:var(--ink3);margin-left:6px}
.kpi .s{font-size:12.5px;color:var(--ink2);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.erow{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:14px;margin-top:14px}
.chead{display:flex;align-items:center;gap:12px}
.chead.small{gap:8px;margin-top:10px}
.leg{margin-left:auto;display:flex;gap:14px;font-size:12.5px;color:rgba(245,238,233,.75)}
.leg span{display:inline-flex;align-items:center;gap:6px}
.sw2{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none}
.dash{width:16px;height:0;border-top:2px dashed rgba(245,238,233,.75);display:inline-block}
.plot{display:flex;gap:6px;margin-top:8px}
.yax{display:flex;flex-direction:column;justify-content:space-between;font-size:10.5px;color:var(--ink3);padding:0;margin:2px 0 -6px;height:180px;line-height:1;text-align:right;min-width:22px;font-variant-numeric:tabular-nums}
.pwrap{position:relative;flex:1;min-width:0;height:180px}
.pwrap.t{height:80px;margin-top:4px}
.pwrap svg{position:absolute;left:0;top:0;width:100%;height:100%}
.hov{position:absolute;left:0;right:0;top:0;bottom:0;display:flex}
.hov span{flex:1;height:100%}
.tip{position:absolute;top:10px;padding:8px 11px;border-radius:12px;background:var(--ink);color:#1b1619;font-size:12.5px;line-height:1.45;white-space:nowrap;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.35);font-variant-numeric:tabular-nums;z-index:2}
.xax{display:flex;justify-content:space-between;padding-left:28px;font-size:10.5px;color:var(--ink3);margin-top:4px}
.escatter{display:flex;flex-direction:column;gap:6px}
.escatter svg{margin-top:6px}
.tk{font-size:10.5px;fill:var(--ink3)}
.estats{margin-top:auto;display:flex;flex-direction:column;gap:6px;font-size:13.5px;color:rgba(245,238,233,.85);font-variant-numeric:tabular-nums}
.estats div{display:flex}
.estats div span:last-child{margin-left:auto}
.ebars .xax{padding-left:0}
.efc{display:flex;flex-direction:column;justify-content:space-between;min-height:150px}
.gplot{display:grid;grid-template-columns:minmax(0,1fr) 27%;gap:20px;margin-top:8px}
.gplot .plot{margin-top:0}
.gtoday{position:relative;display:flex;flex-direction:column;padding-left:20px;border-left:1px solid var(--line)}
.gtl{display:flex;justify-content:space-between;font-size:11px;color:var(--ink3);height:0;position:relative;top:-2px;z-index:1}
.gtl span:first-child{color:var(--ink2)}
.gtoday .pwrap{flex:none}
.gsub{margin-top:6px;font-size:12px}
.yax.r{text-align:left;min-width:24px}
.xax.tr{padding-right:30px}
.tln{width:16px;height:0;border-top:2px solid #5a86e8;display:inline-block}
.ebars .chead .cap{margin-left:auto}
.ebars .chead .cap + .emore{margin-left:12px}.erow.one{grid-template-columns:minmax(0,1fr)}
.erow.half{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.yax.s{height:130px}
.chead .leg + .emore{margin-left:14px}
.emore{margin-left:auto;display:inline-flex;align-items:center;gap:2px;height:32px;padding:0 10px 0 14px;border-radius:16px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:inherit;font-family:inherit;font-size:13.5px;font-weight:500;cursor:pointer}
.emore .ic{width:15px;height:15px;color:var(--ink3)}
.esum{display:flex;align-items:baseline;gap:14px;font-size:13.5px;color:var(--ink2);font-variant-numeric:tabular-nums}
.esum b{font-size:22px;font-weight:400;color:var(--ink)}
.eparts{display:flex;flex-direction:column;gap:5px}
.card > .ctitle + .eparts,.card > .esum + .eparts{margin-top:10px}
.epart{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(40px,1fr) 84px 38px;align-items:center;gap:10px;font-size:13px;font-variant-numeric:tabular-nums}
.epart .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.epart.rest .nm{color:var(--ink2)}
.epart .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
.epart .bar i{display:block;height:100%;border-radius:3px}
.epart .val{color:var(--ink2);text-align:right}
.epart .pct{color:var(--ink3);text-align:right}
.edetail{position:fixed;inset:0;z-index:6;background:rgba(10,8,9,.55)}
.edsheet{overflow:hidden}
.edsheet .chead .round{margin-left:auto}
.edbody{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
.edbody .erow:first-child{margin-top:0}

.vgrid{display:grid;grid-template-columns:minmax(0,1fr) 372px;gap:14px;min-height:100%}
.vmap{display:flex;flex-direction:column;gap:14px}
.vrooms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.vroom{position:relative;height:96px;border-radius:20px;border:1.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);text-align:left;padding:12px 14px;display:flex;align-items:flex-end;cursor:pointer}
.vroom .n{font-size:15px;font-weight:500}
.vroom.sel{background:rgba(94,200,168,.16);border-color:#5ec8a8}
.vroom .chk{position:absolute;right:10px;top:10px;width:24px;height:24px;border-radius:50%;background:#5ec8a8;color:#10201b;display:grid;place-items:center}
.vroom .chk .ic{width:15px;height:15px;stroke-width:2.4}
.vside{display:flex;flex-direction:column;gap:14px}
.vstatus{display:flex;flex-direction:column;gap:14px;background:linear-gradient(170deg,rgba(94,200,168,.14),rgba(255,255,255,.04) 60%)!important}
.vhead{display:flex;align-items:center;gap:14px}
.vic{width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.08);display:grid;place-items:center;flex:none}
.vic .ic{width:28px;height:28px}
.vst{font-size:22px;font-weight:500}
.vbar{height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}
.vbar i{display:block;height:100%;background:#5ec8a8;border-radius:3px}
.vacts{display:grid;grid-template-columns:minmax(0,1fr) 52px 52px;gap:8px}
.vact{height:52px;border-radius:18px;border:0;background:rgba(255,255,255,.09);display:inline-flex;align-items:center;justify-content:center;gap:8px;font-size:15px;font-weight:500;cursor:pointer;padding:0 14px}
.vact:active{transform:scale(.97)}
.vact.pri{background:#5ec8a8;color:#10201b}
.vact[disabled]{opacity:.6}
.vset{display:flex;flex-direction:column;gap:12px}
.vseg{display:flex;flex-direction:column;gap:6px}
.vsl{font-size:12.5px;color:var(--ink2)}
.vopts{display:flex;gap:6px;flex-wrap:wrap}
.opt{flex:1;min-width:60px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:none;font-size:13px;font-weight:500;color:rgba(245,238,233,.8);cursor:pointer;padding:0 6px}
.opt.on{background:rgba(94,200,168,.18);border-color:rgba(94,200,168,.55);color:#bdeedd}
.vmaint{display:flex;flex-direction:column;gap:10px}
.mrow{display:flex;font-size:13.5px;color:rgba(245,238,233,.8);font-variant-numeric:tabular-nums}
.mrow span:last-child{margin-left:auto}
.mrow .low{color:#e0a03a}

.vmapwrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.vmapbox{position:relative;display:inline-block;max-width:100%;line-height:0}
.vimg{display:block;max-width:100%;max-height:540px;width:auto;height:auto}
.vov{position:absolute;left:0;top:0;right:0;bottom:0}
.vcrop{position:relative;overflow:hidden;max-width:100%}
.vimg.crop{position:absolute;max-width:none;max-height:none;height:auto}
.vsel{position:absolute;border-radius:6px;background:rgba(94,200,168,.18);border:1.5px solid rgba(94,200,168,.65);pointer-events:none}
.vchip{position:absolute;-webkit-transform:translate(-50%,-50%);transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 12px;border-radius:16px;border:1px solid rgba(255,255,255,.18);background:rgba(27,22,25,.85);color:var(--ink);font-size:13px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer}
.vchip .ic{width:14px;height:14px;stroke-width:2.4}
.vchip.on{background:#5ec8a8;border-color:#5ec8a8;color:#10201b}

/* ---------- Panels Klima, Licht, Kameras ---------- */
.phead{display:flex;align-items:flex-end;gap:16px;margin-bottom:16px}
.ptitle{font-size:28px;font-weight:500;letter-spacing:-.01em}
.pacts{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.cname{display:inline-flex;align-items:center;gap:4px;border:0;background:none;padding:0;font-size:16px;font-weight:500;cursor:pointer;text-align:left}
.cname .ic{width:16px;height:16px;color:var(--ink3)}
.cgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.ccard{display:flex;flex-direction:column;gap:6px;background:linear-gradient(170deg,rgba(255,255,255,.06),rgba(255,255,255,.03) 60%)!important}
.ccard.hot{background:linear-gradient(170deg,rgba(255,143,92,.16),rgba(255,255,255,.04) 60%)!important;border-color:rgba(255,143,92,.3)!important}
.cnow{font-size:40px;font-weight:300;letter-spacing:-.02em;line-height:1.05;font-variant-numeric:tabular-nums}
.cstate{font-size:13px;color:var(--ink2);min-height:17px}
.cset{display:flex;align-items:center;gap:8px;margin-top:6px}
.ctarget{flex:1;text-align:center;font-size:20px;font-weight:500;font-variant-numeric:tabular-nums}
.ctarget span{display:block;font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.lroom{display:flex;flex-direction:column;gap:10px;margin-bottom:18px}
.scgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.sc{height:64px;border-radius:18px;border:1px solid var(--line);background:rgba(40,33,37,.55);color:inherit;font-family:inherit;display:flex;align-items:center;gap:12px;padding:0 14px;cursor:pointer;text-align:left;transition:background .3s,border-color .3s}
.sc:active{transform:scale(.97)}
.sc .scic{width:32px;height:32px;flex:none;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.08)}
.sc .scic .ic{width:15px;height:15px}
.sc .nm{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc.fired{border-color:rgba(242,166,90,.5);background:rgba(242,166,90,.16)}
.sc.fired .scic{background:var(--light);color:#2a1a0e}
.lt.na{opacity:.5}
.camgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.card.cam{padding:0;overflow:hidden;cursor:pointer;text-align:left;aspect-ratio:16/9;position:relative}
.cam img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#111}
.camname{position:absolute;left:12px;bottom:10px;padding:6px 10px;border-radius:10px;background:rgba(0,0,0,.55);font-size:13px;font-weight:500}
.camlive{position:absolute;left:0;top:0;right:0;bottom:0;background:#000;border-radius:24px;overflow:hidden;z-index:3;display:flex;align-items:center;justify-content:center}
.camlive img{max-width:100%;max-height:100%}
.camlive .round{position:absolute;right:14px;top:14px}

/* ---------- Zweite Ebene (Raumansicht) ---------- */
.dback{position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(15,12,14,.6);z-index:5}
.detail{position:absolute;left:50%;top:50%;-webkit-transform:translate(-50%,-50%);transform:translate(-50%,-50%);width:460px;max-width:92%;max-height:88%;overflow-y:auto;-webkit-overflow-scrolling:touch;z-index:6;padding:20px 22px 22px;border-radius:26px;background:#2a2327;border:1px solid rgba(255,255,255,.1);box-shadow:0 20px 50px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:14px}
.lite .detail{box-shadow:none}
.dhead{display:flex;align-items:flex-start;gap:12px}
.dhead .round{margin-left:auto}
.dtitle{font-size:22px;font-weight:500}
.drow{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:500}
.drow .sw,.drow .dval,.drow .cap{margin-left:auto}
.dval{font-size:14px;color:var(--ink2);font-variant-numeric:tabular-nums}
.dslider{display:flex;flex-direction:column;gap:10px}
.detail input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:36px;border-radius:18px;background:rgba(255,255,255,.1);outline:none;margin:0}
.detail input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:30px;height:30px;border-radius:50%;background:var(--ink);box-shadow:0 2px 8px rgba(0,0,0,.4);border:0}
.detail input.ctrange{background:linear-gradient(90deg,#ffb35c,#fff3e0 50%,#cfe3ff)}
.swatches{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}
.swatch{height:40px;border-radius:12px;border:2px solid rgba(255,255,255,.12);cursor:pointer}
.dclimate{display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line)}
.dclimate:first-of-type{border-top:0;padding-top:0}
.dname{font-size:16px;font-weight:500}
.dlabel{font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin-top:4px}
.modes.left{justify-content:flex-start}

.lcolors{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.lcol{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600}
.lcol input{width:34px;height:28px;border:0;padding:0;background:none;cursor:pointer}
`;
