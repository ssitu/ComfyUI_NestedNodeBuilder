import { app } from "../../scripts/app.js";

// Node that allows you to convert a set of nodes into a single node
export const nestedNodeType = "NestedNode";
export const nestedNodeTitle = "Nested Node";

export function serializeWorkflow(workflow) {
    let nodes = [];
    for (const id in workflow) {
        const node = workflow[id];
        nodes.push(LiteGraph.cloneObject(node.serialize()));
    }
    return nodes;
}

export class NestedNode {

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        // Node setup
        this.properties.serializedWorkflow = serializeWorkflow(workflow);
        this.placeNestedNode(workflow);
        this.resizeNestedNode();
        this.removeNestedNodes(workflow);
        this.inheritWidgetValues();
    }

    // Remove the nodes that are being nested
    removeNestedNodes(workflow) {
        for (const id in workflow) {
            const node = workflow[id];
            app.graph.remove(node);
        }
    }

    // Set the location of the nested node
    placeNestedNode(workflow) {
        // Find the average location of the nested nodes
        let x = 0;
        let y = 0;
        let count = 0;
        for (const id in workflow) {
            const node = workflow[id];
            x += node.pos[0];
            y += node.pos[1];
            count++;
        }
        x /= count;
        y /= count;

        // Set the location of the nested node
        this.pos = [x, y];
    }

    // Resize the nested node
    resizeNestedNode() {
        this.size = this.computeSize();
        this.size[0] *= 1.5;
    }

    // Inherit the widget values of its serialized workflow
    inheritWidgetValues() {
        const serialized = this.properties.serializedWorkflow;
        this.widgets_values = [];
        let widgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            for (const j in node.widgets_values) {
                const widget_value = node.widgets_values[j];
                this.widgets_values.push(widget_value);
                this.widgets[widgetIdx].value = widget_value;
                widgetIdx++;
            }
        }
    }

    // Is called during prompt execution
    applyToGraph(workflow) {
        console.log("[NestedNodeBuilder] Applying serialized workflow to graph", workflow);
    }

    // Update node on property change
    onPropertyChanged(name, value) {
        if (name === "serializedWorkflow") {
            console.log("[NestedNodeBuilder] Serialized workflow changed", structuredClone(value));
            this.inheritWidgetValues();
        }
    }

    updateSerializedWorkflow() {
        // Update the serialized workflow with the current values of the widgets
        const workflow = this.properties.serializedWorkflow;
        for (const i in workflow) {
            const node = workflow[i];
            for (const j in node.widgets_values) {

            }
        }
    }

    onWidgetChanged(name, value, old_value, widget) {
        this.updateSerializedWorkflow();
    }

}
