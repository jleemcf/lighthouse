let phonePanelScroll = null;
function phoneWidth() {
  return !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);
}
function taskPanelScrollBox() {
  if (phoneWidth()) return document.querySelector("#panel .pw-body") || document.getElementById("panel");
  return document.getElementById("panel-talk") || document.getElementById("panel");
}
function scrollPhonePanel(reset) {
  const box = phoneWidth() && state.panel ? taskPanelScrollBox() : null;
  if (reset && phoneWidth()) state.pinned.panel = false;
  if (!box) {
    if (phonePanelScroll) phonePanelScroll.observer.disconnect();
    phonePanelScroll = null;
    return false;
  }
  if (!phonePanelScroll || phonePanelScroll.box !== box || phonePanelScroll.card !== state.panel || reset) {
    if (phonePanelScroll) phonePanelScroll.observer.disconnect();
    const opening = { box, card: state.panel };
    const bottom = () => {
      if (phonePanelScroll === opening && phoneWidth() && !state.pinned.panel) box.scrollTop = box.scrollHeight;
    };
    opening.observer = new ResizeObserver(bottom);
    opening.bottom = bottom;
    phonePanelScroll = opening;
  }
  phonePanelScroll.observer.disconnect();
  for (const child of box.children) phonePanelScroll.observer.observe(child);
  setTimeout(phonePanelScroll.bottom, 0);
  return true;
}
