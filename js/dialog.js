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