import { $el } from "../../scripts/ui.js";

export class ComfirmDialog {
    constructor() {
        this.element = $el("div.comfy-modal", { parent: document.body }, [
            $el("div.comfy-modal-content", [$el("p", { $: (p) => (this.textElement = p) }), this.createButtons()]),
        ]);
        this.element.style.color = "var(--input-text)";
    }

    createButtons() {
        return $el("div", [
            $el("button", {
                type: "button",
                textContent: "Yes",
                onclick: () => this.close(),
            }),
            $el("button", {
                type: "button",
                textContent: "No",
                onclick: () => this.close(),
            }),
        ]);
    }

    close() {
        this.element.style.display = "none";
    }

    show(html, onYes, onNo) {
        if (typeof html === "string") {
            this.textElement.innerHTML = html;
        } else {
            this.textElement.replaceChildren(html);
        }
        this.element.style.display = "flex";

        this.element.querySelector("button:nth-child(1)").onclick = () => {
            this.close();
            onYes();
        }
        this.element.querySelector("button:nth-child(2)").onclick = () => {
            this.close();
            onNo();
        }
    }
}

export function showWidgetDialog(pos, onEnter, onCancel) {
    if (!onEnter) {
        onEnter = () => {};
    }
    if (!onCancel) {
        onCancel = () => {};
    }
    let dialog = app.canvas.createDialog(
        "<span class='name'>Name for nested node:</span><input autofocus type='text' class='value'/><button>OK</button>",
        { position: pos }
    );
    let input = dialog.querySelector("input");
    const cancel = () => {
        onCancel();
        dialog.close();
    };
    const enter = () => {
        onEnter(input);
        dialog.close();
    };
    input.addEventListener("keydown", function (e) {
        if (e.keyCode == 27) { // ESC
            cancel();
        } else if (e.keyCode == 13) { // ENTER
            enter();
        } else if (e.keyCode != 13) {
            dialog.modified();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    });
    let button = dialog.querySelector("button");
    button.addEventListener("click", enter);
}
