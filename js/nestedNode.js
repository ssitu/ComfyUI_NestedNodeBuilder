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

export function applyNestedNode(nestedNode, workflow, serializedWorkflow) {
    console.log("[NestedNodeBuilder] Applying nested node, serializedWorkflow:", structuredClone(serializedWorkflow));
    // Create a temporary graph to leverage the existing logic
    const graph = new LiteGraph.LGraph();

    // Add the original workflow
    graph.configure(workflow);


    // Add the nodes inside the nested node
    const nestedNodes = [];
    for (const serializedNode of serializedWorkflow) {
        const node = LiteGraph.createNode(serializedNode.type);
        node.configure(serializedNode);
        graph.add(node);
        nestedNodes.push(node);
    }
    console.log(nestedNodes);

    // Determine the link mapping of the nested nodes
    const newSerializedWorkflow = serializeWorkflow(nestedNodes);
    console.log(newSerializedWorkflow);
    const linksMapping = mapLinksToNodes(newSerializedWorkflow);
    console.log(linksMapping);

    // Link the nodes inside the nested node
    for (const link in linksMapping) {
        const entry = linksMapping[link];
        if (entry && entry.srcId && entry.dstId) {
            graph.getNodeById(entry.srcId).connect(entry.srcSlot, graph.getNodeById(entry.dstId), entry.dstSlot);
        }
    }

    // Link nodes in the workflow to the nodes nested by the nested node
    let nestedInputSlot = 0;
    let nestedOutputSlot = 0;
    // Assuming that the order of inputs and outputs of each node of the nested workflow 
    // is in the same order as the inputs and outputs of the nested node
    console.log(nestedNodes);
    for (const node of nestedNodes) {
        for (let inputSlot = 0; inputSlot < (node.inputs ?? []).length; inputSlot++) {
            // Out of bounds, rest of the inputs are not connected to the outside
            if (nestedInputSlot >= nestedNode.inputs.length) {
                break;
            }
            // If types don't match, then skip this input
            if (node.inputs[inputSlot].type !== nestedNode.inputs[nestedInputSlot].type) {
                continue;
            }
            const link = nestedNode.getInputLink(nestedInputSlot);
            if (link) { // Just in case
                const originNode = graph.getNodeById(link.origin_id);
                originNode.connect(link.origin_slot, node, inputSlot);
            }
            nestedInputSlot++;
        }
        for (let outputSlot = 0; outputSlot < (node.outputs ?? []).length; outputSlot++) {
            // Out of bounds, rest of the outputs are not connected to the outside
            if (nestedOutputSlot >= nestedNode.outputs.length) {
                break;
            }
            // If types don't match, then skip this output
            if (node.outputs[outputSlot].type !== nestedNode.outputs[nestedOutputSlot].type) {
                continue;
            }
            const links = nestedNode.getOutputInfo(nestedOutputSlot).links;
            for (const linkId of links ?? []) {
                const link = graph.links[linkId];
                if (link) {
                    const targetNode = graph.getNodeById(link.target_id);
                    node.connect(outputSlot, targetNode, link.target_slot);
                }
            }
            nestedOutputSlot++;
        }
    }

    // Remove the nested node, must use id because a clone of the node is in the graph
    graph.remove(graph.getNodeById(nestedNode.id));

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
        const graphSerialized = applyNestedNode(this, workflow, this.properties.serializedWorkflow);
        workflow = graphSerialized;
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
