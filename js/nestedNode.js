import { app } from "../../scripts/app.js";
import { mapLinksToNodes, isOutputInternal } from "./nodeMenu.js";

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
    const result = structuredClone(serializedWorkflow);
    for (const node of result) {
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
    return result;
}

function averagePos(nodes) {
    let x = 0;
    let y = 0;
    let count = 0;
    for (const i in nodes) {
        const node = nodes[i];
        x += node.pos[0];
        y += node.pos[1];
        count++;
    }
    x /= count;
    y /= count;
    return [x, y];
}

export class NestedNode {

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        // Node setup
        this.properties.serializedWorkflow = serializeWorkflow(workflow);
        this.placeNestedNode(workflow);
        this.resizeNestedNode();
        this.inheritLinks();
        this.inheritWidgetValues();
        this.removeNestedNodes(workflow);
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
        this.pos = averagePos(workflow)
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

    // Inherit the links of its serialized workflow, 
    // must be before the nodes that are being nested are removed from the graph
    inheritLinks() {
        const serialized = this.properties.serializedWorkflow;
        const linksMapping = mapLinksToNodes(serialized);
        for (const linkId in linksMapping) {
            const entry = linksMapping[linkId];
            if (entry.srcId && entry.dstId) { // Link between nodes within the nested workflow
                continue;
            }
            const link = app.graph.links[linkId];
            if (entry.dstId) { // Input connected from outside
                // This will be the new target node
                const src = app.graph.getNodeById(link.origin_id);
                const dstSlot = this.getNestedInputSlot(entry.dstId, entry.dstSlot);
                src.connect(link.origin_slot, this, dstSlot);
            }
            else if (entry.srcId) { // Output connected to outside
                // This will be the new origin node
                const dst = app.graph.getNodeById(link.target_id);
                const srcSlot = this.getNestedOutputSlot(entry.srcId, entry.srcSlot);
                this.connect(srcSlot, dst, link.target_slot);
            }
        }
    }

    getNestedInputSlot(internalNodeId, internalSlotId) {
        // Converts a node slot that was nested into a slot of the resulting nested node
        const serialized = this.properties.serializedWorkflow;
        let slotIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            if (node.id === internalNodeId) {
                if (internalSlotId >= node.inputs.length) {
                    return null;
                }
                return slotIdx + internalSlotId;
            }
            slotIdx += node.inputs.length;
        }
        return null;
    }

    getNestedOutputSlot(internalNodeId, internalSlotId) {
        // Converts a node slot that was nested into a slot of the resulting nested node
        const serialized = this.properties.serializedWorkflow;
        let slotIdx = 0;

        const linksMapping = mapLinksToNodes(serialized);
        for (const i in serialized) {
            const node = serialized[i];
            if (node.id === internalNodeId) {
                if (internalSlotId >= node.outputs.length) {
                    return null;
                }
                return slotIdx + internalSlotId;
            }
            let numNonInternalOutputs = 0;
            for (const j in node.outputs) {
                // const output = node.outputs[j];
                // if (!output.links || output.links.length === 0) {
                //     numNonInternalOutputs++;
                //     continue;
                // }
                // for (const link of output.links) {
                //     const entry = linksMapping[link];
                //     if (!(entry.srcId && entry.dstId)) {
                //         numNonInternalOutputs++;
                //         break;
                //     }
                // }
                if (!isOutputInternal(node, j, linksMapping)) {
                    numNonInternalOutputs++;
                }
            }
            slotIdx += numNonInternalOutputs;
        }
        return null;
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
        const serialized = this.properties.serializedWorkflow;
        let widgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            for (const j in node.widgets_values) {
                node.widgets_values[j] = this.widgets[widgetIdx].value;
                widgetIdx++;
            }
        }
    }

    onWidgetChanged(name, value, old_value, widget) {
        this.updateSerializedWorkflow();
    }

    unnest() {
        const serializedWorkflow = this.properties.serializedWorkflow;
        const linksMapping = mapLinksToNodes(serializedWorkflow);
        // Add the nodes inside the nested node
        const nestedNodes = [];
        const internalOutputList = [];
        const avgPos = averagePos(serializedWorkflow);
        const serializedToNodeMapping = {};
        for (const idx in serializedWorkflow) {
            const serializedNode = serializedWorkflow[idx];
            const node = LiteGraph.createNode(serializedNode.type);
            node.configure(serializedNode);

            const dx = serializedNode.pos[0] - avgPos[0];
            const dy = serializedNode.pos[1] - avgPos[1];
            node.pos = [this.pos[0] + dx, this.pos[1] + dy];

            const isOutputsInternal = [];
            for (const i in serializedNode.outputs) {
                const output = serializedNode.outputs[i];
                let isInternal = true;
                if (!output.links || output.links.length === 0) {
                    isInternal = false;
                }
                for (const link of output.links ?? []) {
                    const entry = linksMapping[link];
                    if (!(entry.srcId && entry.dstId)) {
                        isInternal = false;
                        break;
                    }
                }
                isOutputsInternal.push(isInternal);
            }
            internalOutputList.push(isOutputsInternal);

            // Clear links
            for (const i in node.inputs) {
                node.inputs[i].link = null;
            }
            for (const i in node.outputs) {
                node.outputs[i].links = [];
            }

            app.graph.add(node);
            nestedNodes.push(node);
            serializedToNodeMapping[serializedNode.id] = node;
        }


        // Link the nodes inside the nested node
        for (const link in linksMapping) {
            const entry = linksMapping[link];
            if (entry && entry.srcId && entry.dstId) {
                // app.graph.getNodeById(entry.srcId).connect(entry.srcSlot, app.graph.getNodeById(entry.dstId), entry.dstSlot);
                const src = serializedToNodeMapping[entry.srcId];
                const dst = serializedToNodeMapping[entry.dstId];
                src.connect(entry.srcSlot, dst, entry.dstSlot);
            }
        }

        // Link nodes in the workflow to the nodes nested by the nested node
        let nestedInputSlot = 0;
        let nestedOutputSlot = 0;
        // Assuming that the order of inputs and outputs of each node of the nested workflow 
        // is in the same order as the inputs and outputs of the nested node
        for (const i in nestedNodes) {
            const node = nestedNodes[i];
            for (let inputSlot = 0; inputSlot < (node.inputs ?? []).length; inputSlot++) {
                // Out of bounds, rest of the inputs are not connected to the outside
                if (nestedInputSlot >= this.inputs.length) {
                    break;
                }
                // If types don't match, then skip this input
                if (node.inputs[inputSlot].type !== this.inputs[nestedInputSlot].type) {
                    continue;
                }
                const link = this.getInputLink(nestedInputSlot);
                if (link) { // Just in case
                    const originNode = app.graph.getNodeById(link.origin_id);
                    originNode.connect(link.origin_slot, node, inputSlot);
                }
                nestedInputSlot++;
            }
            for (let outputSlot = 0; outputSlot < (node.outputs ?? []).length; outputSlot++) {
                // Out of bounds, rest of the outputs are not connected to the outside
                if (nestedOutputSlot >= this.outputs.length) {
                    break;
                }
                // If types don't match, then skip this output
                if (node.outputs[outputSlot].type !== this.outputs[nestedOutputSlot].type) {
                    continue;
                }
                // If the output is only connected internally, then skip this output
                if (internalOutputList[i][outputSlot]) {
                    continue;
                }

                const links = this.getOutputInfo(nestedOutputSlot).links;
                for (const linkId of links ?? []) {
                    const link = app.graph.links[linkId];
                    if (link) {
                        const targetNode = app.graph.getNodeById(link.target_id);
                        node.connect(outputSlot, targetNode, link.target_slot);
                    }
                }
                nestedOutputSlot++;
            }
        }

        // Remove the nested node
        app.graph.remove(graph.getNodeById(this.id));

        return nestedNodes;
    }
}
