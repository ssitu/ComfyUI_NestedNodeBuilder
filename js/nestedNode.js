import { app } from "../../scripts/app.js";
import { mapLinksToNodes } from "./nodeMenu.js";

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

export function cleanLinks(serializedWorkflow) {
    // Remove links that are not connections between nodes within the workflow
    const linksMapping = mapLinksToNodes(serializedWorkflow);
    for (const node of serializedWorkflow) {
        for (const input of node.inputs ?? []) { // Some nodes don't have inputs
            const entry = linksMapping[input.link];
            const isLinkWithinWorkflow = entry && entry.srcId && entry.dstId;
            if (!isLinkWithinWorkflow) {
                // Remove link
                input.link = null;
            }
        }
        for (const output of node.outputs ?? []) {
            for (const link of output.links ?? []) {
                const entry = linksMapping[link];
                const isLinkWithinWorkflow = entry && entry.srcId && entry.dstId;
                if (!isLinkWithinWorkflow) {
                    // Remove link, should be unique
                    output.links.splice(output.links.indexOf(link), 1);
                }
            }
        }
    }
}

export function serializedWorkflowToGraph(serializedWorkflow) {
    const linksMapping = mapLinksToNodes(serializedWorkflow);
    // Create a temporary graph to leverage the existing logic
    const graph = new LiteGraph.LGraph();
    for (const serializedNode of serializedWorkflow) {
        const node = LiteGraph.createNode(serializedNode.type);
        node.configure(serializedNode);
        graph.add(node);
    }
    console.log("[NestedNodeBuilder] Graph created", structuredClone(graph.serialize()))
    for (const link in linksMapping) {
        const entry = linksMapping[link];
        console.log(entry);
        if (entry && entry.srcId && entry.dstId) {
            graph.getNodeById(entry.srcId).connect(entry.srcSlot, graph.getNodeById(entry.dstId), entry.dstSlot);
        }
    }
    console.log("[NestedNodeBuilder] Graph linked", structuredClone(graph.serialize()))
    const graphSerialized = graph.serialize();
    return graphSerialized;
}

export class NestedNode {

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        // Node setup
        this.properties.serializedWorkflow = serializeWorkflow(workflow);
        cleanLinks(this.properties.serializedWorkflow);
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
        console.log("[NestedNodeBuilder] Applying serialized workflow to graph", structuredClone(workflow));
        const graphSerialized = serializedWorkflowToGraph(this.properties.serializedWorkflow);
        console.log("[NestedNodeBuilder] Graph serialized", structuredClone(graphSerialized));
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
