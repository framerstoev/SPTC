(function initializeRankingBrowser(global) {
  "use strict";

  // A deterministic table, not a conversation action. Scope is copied from a
  // validated completed ranking; neither this module nor paging invokes Qwen.
  function createController(options = {}) {
    const documentRef = options.document || global.document;
    const client = options.client || global.SPTCAssistant.client;
    const dialog = documentRef.getElementById("rankingDialog");
    const title = documentRef.getElementById("rankingHeading");
    const scope = documentRef.getElementById("rankingScope");
    const range = documentRef.getElementById("rankingRange");
    const body = documentRef.getElementById("rankingRows");
    const close = documentRef.getElementById("rankingClose");
    const buttons = Object.fromEntries(["First", "Previous", "Next", "Last"].map(name =>
      [name.toLowerCase(), documentRef.getElementById(`ranking${name}`)]));
    let selection = null;
    let page = null;
    let pending = null;
    let generation = 0;
    let returnFocus = null;
    const format = value => typeof value === "number"
      ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : String(value);

    function cancel() {
      generation += 1;
      pending?.abort();
      pending = null;
    }

    function updateButtons(loading) {
      const last = page ? Math.max(0, Math.ceil(page.total_count / page.page_size) - 1) * page.page_size : 0;
      buttons.first.disabled = buttons.previous.disabled = loading || !page || page.offset === 0;
      buttons.next.disabled = buttons.last.disabled = loading || !page || page.offset >= last;
    }

    async function load(offset) {
      if (!selection || !dialog.open) return;
      cancel();
      const current = generation;
      pending = new global.AbortController();
      dialog.setAttribute("aria-busy", "true");
      range.textContent = "Loading deterministic ranking…";
      body.replaceChildren();
      updateButtons(true);
      try {
        const result = await client.getRankedSectionsPage({ ...selection, offset, page_size: 25 },
          { signal: pending.signal });
        if (current !== generation || !dialog.open) return;
        page = result;
        for (const row of page.rows) {
          const tr = documentRef.createElement("tr");
          for (const value of [row.metric_rank, row.section_id, row.route, row.county, row.value,
            row.detection_status.replaceAll("_", " ")]) {
            const td = documentRef.createElement("td");
            td.textContent = format(value);
            tr.appendChild(td);
          }
          body.appendChild(tr);
        }
        range.textContent = page.total_count === 0 ? "No eligible sections."
          : `Showing ${format(page.offset + 1)}–${format(page.offset + page.rows.length)} of ${format(page.total_count)}`;
      } catch (error) {
        if (current !== generation || !dialog.open) return;
        page = null;
        range.textContent = "The verified ranking could not load. Close and reopen to try again.";
      } finally {
        if (current === generation) {
          pending = null;
          dialog.setAttribute("aria-busy", "false");
          updateButtons(false);
        }
      }
    }

    function open(result, trigger) {
      cancel();
      page = null;
      selection = { metric: result.metric.metric, direction: result.direction, county: result.county };
      returnFocus = trigger;
      title.textContent = `Full ranking · ${result.metric.display_name}`;
      scope.textContent = `${result.county ? result.county + " County" : "Statewide"} · ${result.direction}. Higher values: ${result.metric.higher_value_interpretation}. Equal values share dense rank; control-section IDs break display ties.`;
      dialog.showModal();
      close.focus();
      void load(0);
    }

    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", event => {
      // Keep Escape inside this modal; do not also close the floating Assistant.
      event.preventDefault();
      dialog.close();
    });
    dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    dialog.addEventListener("close", () => {
      cancel();
      selection = null;
      page = null;
      body.replaceChildren();
      dialog.setAttribute("aria-busy", "false");
      if (returnFocus?.isConnected) returnFocus.focus();
    });
    buttons.first.addEventListener("click", () => void load(0));
    buttons.previous.addEventListener("click", () => page && void load(Math.max(0, page.offset - page.page_size)));
    buttons.next.addEventListener("click", () => page && void load(page.offset + page.page_size));
    buttons.last.addEventListener("click", () => page && void load(
      Math.max(0, Math.ceil(page.total_count / page.page_size) - 1) * page.page_size));
    updateButtons(false);
    return Object.freeze({ open });
  }

  global.SPTCRankingBrowser = Object.freeze({ createController });
})(window);
