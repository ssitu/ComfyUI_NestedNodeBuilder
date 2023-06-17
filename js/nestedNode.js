import { app } from "../../scripts/app.js";
import { mapLinksToNodes, isOutputInternal, isInputInternal, nodeDefs } from "./nodeMenu.js";

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

    nestedNodeSetup() {
        this.numDefinedInputs = 0;
        for (const input of this.inputs) {
            if (input.widget) {
                break;
            }
            this.numDefinedInputs++;
        }
        this.addWidgetListeners();
    }

    onAdded() {
        if (!this.isSetup) {
            this.nestedNodeSetup();
            this.isSetup = true;
        }
    }

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        // Node setup
        this.properties.nestedData = {};
        this.properties.nestedData.nestedNodes = serializeWorkflow(workflow);
        this.placeNestedNode(workflow);
        this.resizeNestedNode();
        this.inheritConvertedWidgets();
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
        const serialized = this.properties.nestedData.nestedNodes;
        this.widgets_values = [];
        let widgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            // Create a temporary node to get access to widgets that are not 
            // included in its node definition (e.g. control_after_generate)
            const tempNode = LiteGraph.createNode(node.type);
            for (const j in node.widgets_values) {
                // Must skip widgets that were unable to be added to the nested node
                const thisWidget = this.widgets?.[widgetIdx];
                const tempWidget = tempNode?.widgets?.[j];
                // Remove trailing numbers from the name
                const thisWidgetName = thisWidget?.name.replace(/\d+$/, '');;
                if (thisWidgetName !== tempWidget?.name) {
                    continue;
                }
                const widget_value = node.widgets_values[j];
                this.widgets_values.push(widget_value);
                this.widgets[widgetIdx].value = widget_value;
                widgetIdx++;
            }
        }
    }

    inheritConvertedWidgets() {
        const serialized = this.properties.nestedData.nestedNodes;
        const widgetToCount = {};
        for (const nodeIdx in serialized) {
            const node = serialized[nodeIdx];
            for (const inputIdx in node.inputs ?? []) {
                const input = node.inputs[inputIdx];
                if (input.widget) {
                    const nestedWidgetName = input.widget.name + (widgetToCount[input.widget.name] ?? '');
                    for (let widgetIdx = 0; widgetIdx < this.widgets.length; widgetIdx++) {
                        const widget = this.widgets[widgetIdx];
                        const widgetName = widget.name;
                        if (widget.type !== CONVERTED_TYPE) {
                            continue;
                        }
                        if (widgetName === nestedWidgetName) {
                            const config = getConfig(nodeDefs[node.type], widget);
                            convertToInput(this, widget, config);
                            widgetToCount[input.widget.name] = (widgetToCount[input.widget.name] ?? 1) + 1;
                            break;
                        }
                    }
                }
            }
        }
    }

    updateSerializedWorkflow() {
        // Update the serialized workflow with the current values of the widgets
        const serialized = this.properties.nestedData.nestedNodes;
        let widgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            const tempNode = LiteGraph.createNode(node.type);
            for (const j in node.widgets_values) {

                const thisWidget = this.widgets?.[widgetIdx];
                const tempWidget = tempNode?.widgets?.[j];
                const thisWidgetName = thisWidget?.name.replace(/\d+$/, '');;
                if (thisWidgetName !== tempWidget?.name) {
                    continue;
                }

                node.widgets_values[j] = thisWidget.value;
                widgetIdx++;
            }
        }
    }

    // Add listeners to the widgets
    addWidgetListeners() {
        for (const widget of this.widgets) {
            if (widget.inputEl) {
                widget.inputEl.addEventListener("change", (e) => {
                    this.onWidgetChanged(widget.name, widget.value, widget.value, widget);
                });
            }
        }
    }

    // Update node on property change
    onPropertyChanged(name, value) {
        if (name === "serializedWorkflow") {
            this.inheritWidgetValues();
        }
    }

    onWidgetChanged(name, value, old_value, widget) {
        this.updateSerializedWorkflow();
    }

    beforeQueuePrompt() {
        this.updateSerializedWorkflow()
    }

    // Inherit the links of its serialized workflow, 
    // must be before the nodes that are being nested are removed from the graph
    inheritLinks() {
        const serialized = this.properties.nestedData.nestedNodes;
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
        // Converts a node slot that was nested into a slot of the resulting nested node.
        const serialized = this.properties.nestedData.nestedNodes;
        const linksMapping = mapLinksToNodes(serialized);
        let slotIdx = 0;
        // Keep separate index for converted widgets, since they are put at the end of the defined inputs.
        let convertedSlotIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            const nodeInputs = node.inputs ?? [];
            for (let inputIdx = 0; inputIdx < nodeInputs.length; inputIdx++) {
                const isConvertedWidget = !!nodeInputs[inputIdx].widget;
                const isCorrectSlot = node.id === internalNodeId && inputIdx === internalSlotId;
                if (isConvertedWidget) {
                    if (isCorrectSlot) {
                        return this.numDefinedInputs + convertedSlotIdx;
                    }
                    convertedSlotIdx++;
                    continue;
                }
                if (isCorrectSlot) {
                    return slotIdx;
                }
                if (!isInputInternal(node, inputIdx, linksMapping)) {
                    slotIdx++;
                }
            }
        }
        return null;
    }

    getNestedOutputSlot(internalNodeId, internalSlotId) {
        // Converts a node slot that was nested into a slot of the resulting nested node
        const serialized = this.properties.nestedData.nestedNodes;
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
                if (!isOutputInternal(node, j, linksMapping)) {
                    numNonInternalOutputs++;
                }
            }
            slotIdx += numNonInternalOutputs;
        }
        return null;
    }

    unnest() {
        const serializedWorkflow = this.properties.nestedData.nestedNodes;
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
                if (nestedInputSlot >= (this.inputs ?? []).length) {
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
                if (nestedOutputSlot >= (this.outputs ?? []).length) {
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

        // Add the nodes to selection
        for (const node of nestedNodes) {
            app.canvas.selectNode(node, true);
        }

        return nestedNodes;
    }

    getConnectedInputNodes() {
        const result = [];
        for (let inputSlot = 0; inputSlot < this.inputs.length; inputSlot++) {
            const link = this.getInputLink(inputSlot);
            if (link) {
                const originNode = app.graph.getNodeById(link.origin_id);
                const data = {
                    node: originNode,
                    srcSlot: link.origin_slot,
                    dstSlot: inputSlot,
                };
                result.push(data);
            }
        }
        return result;
    }
}

const CONVERTED_TYPE = "converted-widget";
const VALID_TYPES = ["STRING", "combo", "number"];

export function isConvertableWidget(widget, config) {
    return VALID_TYPES.includes(widget.type) || VALID_TYPES.includes(config[0]);
}

function hideWidget(node, widget, suffix = "") {
    widget.origType = widget.type;
    widget.origComputeSize = widget.computeSize;
    widget.origSerializeValue = widget.serializeValue;
    widget.computeSize = () => [0, -4]; // -4 is due to the gap litegraph adds between widgets automatically
    widget.type = CONVERTED_TYPE + suffix;
    widget.serializeValue = () => {
        // Prevent serializing the widget if we have no input linked
        const { link } = node.inputs.find((i) => i.widget?.name === widget.name);
        if (link == null) {
            return undefined;
        }
        return widget.origSerializeValue ? widget.origSerializeValue() : widget.value;
    };

    // Hide any linked widgets, e.g. seed+seedControl
    if (widget.linkedWidgets) {
        for (const w of widget.linkedWidgets) {
            hideWidget(node, w, ":" + widget.name);
        }
    }
}

function showWidget(widget) {
    widget.type = widget.origType;
    widget.computeSize = widget.origComputeSize;
    widget.serializeValue = widget.origSerializeValue;

    delete widget.origType;
    delete widget.origComputeSize;
    delete widget.origSerializeValue;

    // Hide any linked widgets, e.g. seed+seedControl
    if (widget.linkedWidgets) {
        for (const w of widget.linkedWidgets) {
            showWidget(w);
        }
    }
}

function convertToInput(node, widget, config) {
    hideWidget(node, widget);

    const { linkType } = getWidgetType(config);

    // Add input and store widget config for creating on primitive node
    const sz = node.size;
    node.addInput(widget.name, linkType, {
        widget: { name: widget.name, config },
    });

    // Restore original size but grow if needed
    node.setSize([Math.max(sz[0], node.size[0]), Math.max(sz[1], node.size[1])]);
}

function convertToWidget(node, widget) {
    showWidget(widget);
    const sz = node.size;
    node.removeInput(node.inputs.findIndex((i) => i.widget?.name === widget.name));

    // Restore original size but grow if needed
    node.setSize([Math.max(sz[0], node.size[0]), Math.max(sz[1], node.size[1])]);
}

function getWidgetType(config) {
    // Special handling for COMBO so we restrict links based on the entries
    let type = config[0];
    let linkType = type;
    if (type instanceof Array) {
        type = "COMBO";
        linkType = linkType.join(",");
    }
    return { type, linkType };
}

function getConfig(nodeData, widget) {
    return nodeData?.input?.required[widget.name] || nodeData?.input?.optional?.[widget.name] || [widget.type, widget.options || {}];
}