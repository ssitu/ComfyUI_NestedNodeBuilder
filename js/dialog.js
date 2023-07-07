import { $el } from "../../scripts/ui.js";

export class ComfirmDialog {
    constructor() {
        this.element = $el("div.comfy-modal", { parent: document.body }, [
            $el("div.comfy-modal-content", [$el("p", { $: (p) => (this.textElement = p) }), this.createButtons()]),
        ]);
        this.element.style.color = "var(--input-text)";
    }

    createButtons() {
        this.yesButton = $el("button", {
            type: "button",
            textContent: "Yes",
            onclick: () => this.close(),
        });
        this.noButton = $el("button", {
            type: "button",
            textContent: "No",
            onclick: () => this.close(),
        });
        return $el("div", [this.yesButton, this.noButton]);
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
        this.yesButton.focus();
    }
}

export function showWidgetDialog(pos, prompt, onEnter, onCancel) {
    if (!onEnter) {
        onEnter = () => { };
    }
    if (!onCancel) {
        onCancel = () => { };
    }
    const htmlElement = `<span class='name'>${prompt}</span><input autofocus type='text' class='value'/><button>OK</button>`
    let dialog = app.canvas.createDialog(
        htmlElement,
        { position: pos }
    );
    let input = dialog.querySelector("input");
    input.focus();
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
