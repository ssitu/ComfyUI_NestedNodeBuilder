import { app } from "../../scripts/app.js";
import { mapLinksToNodes, isOutputInternal, isInputInternal, nodeDefs } from "./nodeMenu.js";

// Node that allows you to convert a set of nodes into a single node
export const nestedNodeType = "NestedNode";
export const nestedNodeTitle = "Nested Node";

const HIDDEN_CONVERTED_TYPE = "hidden-converted-widget";
const INHERITED_CONVERTED_TYPE = "inherited-converted-widget";

export function serializeWorkflow(workflow) {
    let nodes = [];
    for (const id in workflow) {
        const node = workflow[id];
        nodes.push(LiteGraph.cloneObject(node.serialize()));
    }
    return nodes;
}

export function arrToIdMap(serialiedWorkflow) {
    const result = {};
    for (const node of serialiedWorkflow) {
        result[node.id] = node;
    }
    return result;
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

    get nestedNodes() {
        return this.properties.nestedData.nestedNodes;
    }

    nestedNodeSetup() {
        console.log("[NestedNodeBuilder] Nested node setup")
        this.addWidgetListeners();
        this.nestedNodeIdMapping = arrToIdMap(this.nestedNodes);
        this.linksMapping = mapLinksToNodes(this.nestedNodes);

        this.inheritRerouteNodeInputs();
        this.inheritRerouteNodeOutputs();
        this.inheritConvertedWidgets();
        this.inheritPrimitiveWidgets();
        this.renameInputs();
        this.resizeNestedNode();
        this.inheritWidgetValues();

        // Avoid widgetInputs.js from changing the widget type
        const origOnConfigure = this.onConfigure;
        this.onConfigure = function () {
            const widgets = [];
            for (const input of this.inputs ?? []) {
                if (input.isInherited || (input.isReroute && input.widget)) {
                    widgets.push(input.widget);
                    input.widget = undefined;
                } else {
                    widgets.push(null);
                }
            }
            const r = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
            for (let i = 0; i < (this.inputs ?? []).length; i++) {
                if (widgets[i]) {
                    this.inputs[i].widget = widgets[i];
                }
            }
            return r;
        };
    }

    getNumDefinedInputs() {
        let num = 0;
        for (const input of this.inputs ?? []) {
            if (input.widget) {
                break;
            }
            num++;
        }
        return num;
    }

    onAdded() {
        if (!this.isSetup) {
            this.nestedNodeSetup();
            this.isSetup = true;
        }
    }

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        console.log("[NestedNodeBuilder] Nesting workflow")
        // Node setup
        this.properties.nestedData = { nestedNodes: serializeWorkflow(workflow) };
        this.linksMapping = mapLinksToNodes(this.nestedNodes);
        this.placeNestedNode(workflow);
        // this.inheritRerouteNodeInputs();
        // this.inheritConvertedWidgets();
        // this.renameInputs();
        this.inheritLinks();
        this.inheritWidgetValues();
        this.removeNestedNodes(workflow);
        // this.resizeNestedNode();
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

    renameInputs() {
        // Undo the unique name suffixes

        // Inputs
        for (const input of this.inputs ?? []) {
            input.name = input.name.replace(/_\d+$/, '');
        }
        // Widgets
        for (const widget of this.widgets ?? []) {
            widget.name = widget.name.replace(/_\d+$/, '');
        }
    }

    inheritPrimitiveWidgets() {
        const serialized = this.nestedNodes;
        const linksMapping = this.linksMapping;
        let widgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            // Create a temporary node to get access to widgets that are not 
            // included in its node definition (e.g. control_after_generate)
            const tempNode = LiteGraph.createNode(node.type);
            if (tempNode.type == "PrimitiveNode" && node.outputs[0].links) {
                const tempGraph = new LiteGraph.LGraph();
                tempGraph.add(tempNode);
                const linkId = node.outputs[0].links[0];
                const entry = linksMapping[linkId];
                const dst = this.nestedNodeIdMapping[entry.dstId];
                const dstNode = LiteGraph.createNode(dst.type);
                tempGraph.add(dstNode);
                dstNode.configure(dst);
                tempNode.configure(node);
                // Using the first widget for now, since that is the one with the actual value
                const widget = tempNode.widgets[0];
                delete widget.callback
                widget.name = tempNode.title
                this.widgets.splice(widgetIdx - 1, 0, widget);
                widgetIdx++;
            } else {
                widgetIdx += (node.widgets_values ?? []).length;
            }
        }
    }

    // Inherit the widget values of its serialized workflow
    inheritWidgetValues() {
        const serialized = this.nestedNodes;
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
                // If primitive, then tempWidget will always be undefined
                if (!thisWidget || (!tempWidget && tempNode.type !== "PrimitiveNode")) {
                    continue;
                }
                // Remove trailing numbers from the name
                const thisWidgetName = thisWidget?.name.replace(/_\d+$/, '');
                const primitveMatch = node.type === "PrimitiveNode" && thisWidget?.name === node.title;
                if (thisWidgetName !== tempWidget?.name && !primitveMatch) {
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
        const serialized = this.nestedNodes;
        const widgetToCount = {};
        const linksMapping = this.linksMapping;
        if (!this.widgets || this.widgets.length == 0) {
            return;
        }
        for (const nodeIdx in serialized) {
            const node = serialized[nodeIdx];
            for (const inputIdx in node.inputs ?? []) {
                const input = node.inputs[inputIdx];
                if (input.widget) {
                    const count = widgetToCount[input.widget.name];
                    const suffix = count ? '_' + count : '';
                    const nestedWidgetName = input.widget.name + suffix
                    for (let widgetIdx = 0; widgetIdx < this.widgets.length; widgetIdx++) {
                        const widget = this.widgets[widgetIdx];
                        const widgetName = widget.name;
                        // Skip widgets that are already converted, to avoid duplicating 
                        // converted widget inputs after queueing a prompt because the nesting node 
                        // is reused, so it has the converted widgets already)
                        if (widget.type === INHERITED_CONVERTED_TYPE || widget.type === HIDDEN_CONVERTED_TYPE || widget.type === CONVERTED_TYPE) {
                            continue;
                        }
                        if (widgetName === nestedWidgetName) {
                            // widget.name = nestedWidgetName.replace(/_\d+$/, '');
                            const config = getConfig(nodeDefs[node.type], widget);
                            convertToInput(this, widget, config);
                            widgetToCount[input.widget.name] = (widgetToCount[input.widget.name] ?? 1) + 1;

                            // If the serialized node has its converted widget connected to another node in the nesting,
                            // then remove the converted widget from the inputs.
                            if (isInputInternal(node, inputIdx, linksMapping)) {
                                this.inputs.pop();
                                // Change the type of the widget so that it won't be picked up by the right click menu
                                widget.type = HIDDEN_CONVERTED_TYPE;
                            } else {
                                widget.type = INHERITED_CONVERTED_TYPE;
                                this.inputs.at(-1).isInherited = true;
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    updateSerializedWorkflow() {
        // Update the serialized workflow with the current values of the widgets
        const serialized = this.nestedNodes;
        let widgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            const tempNode = LiteGraph.createNode(node.type);
            for (const j in node.widgets_values) {

                const thisWidget = this.widgets?.[widgetIdx];
                if (!thisWidget) continue;
                const tempWidget = tempNode?.widgets?.[j];

                if (node.type !== "PrimitiveNode") {
                    // Undefined widget
                    if (!tempWidget) continue;

                    const thisWidgetName = thisWidget?.name.replace(/_\d+$/, '');
                    if (thisWidgetName !== tempWidget?.name) continue;
                    node.widgets_values[j] = thisWidget.value;
                    widgetIdx++;
                } else {
                    // Widgets for Primitive nodes will always be undefined
                    const thisWidgetName = thisWidget?.name.replace(/_\d+$/, '');
                    if (thisWidgetName !== node.title) continue;

                    node.widgets_values[j] = thisWidget.value;
                    widgetIdx++;
                    // Skip the rest of the widgets of the primitive node, only care about the value widget
                    break;
                }

            }
        }
    }

    // Add listeners to the widgets
    addWidgetListeners() {
        for (const widget of this.widgets ?? []) {
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

    insertInput(name, type, index) {
        // Instead of appending to the end, insert at the given index, 
        // pushing the rest of the inputs towards the end.

        // Add the new input
        this.addInput(name, type);
        const input = this.inputs.pop();
        this.inputs.splice(index, 0, input);
        return input;
    }

    insertOutput(name, type, index) {
        // Similar to insertInput

        // Add the new output
        this.addOutput(name, type);
        const output = this.outputs.pop();
        this.outputs.splice(index, 0, output);
        return output;
    }


    inheritRerouteNodeInputs() {
        // Inherit the inputs of reroute nodes, since they are not added
        // to the node definition so they must be added manually.

        let inputIdx = 0;
        const serialized = this.nestedNodes;
        const linksMapping = this.linksMapping;
        for (const node of serialized) {
            if (node.type === "Reroute" && !this.inputs?.[inputIdx]?.isReroute) {
                // Allow the use of titles on reroute nodes for custom input names
                const rerouteName = node.outputs[0].name;
                const rerouteType = node.outputs[0].type;
                const inputName = node.title ? node.title : rerouteName;
                const newInput = this.insertInput(inputName, rerouteType, inputIdx);
                newInput.isReroute = true;
                newInput.widget = node?.inputs?.[0]?.widget;
            }
            for (let i = 0; i < (node.inputs ?? []).length; i++) {
                const isConvertedWidget = !!node.inputs[i].widget;
                if (!isInputInternal(node, i, linksMapping) && !isConvertedWidget) inputIdx++;
            }
        }
    }

    inheritRerouteNodeOutputs() {
        // Inherit the outputs of reroute nodes

        let outputIdx = 0;
        const serialized = this.nestedNodes;
        const linksMapping = this.linksMapping;
        for (const node of serialized) {
            if (node.type === "Reroute" && !this.outputs?.[outputIdx]?.isReroute && !isOutputInternal(node, 0, linksMapping)) {
                const rerouteName = node.outputs[0].name;
                const rerouteType = node.outputs[0].type;
                const outputName = node.title ? node.title : rerouteName;
                const newOutput = this.insertOutput(outputName, rerouteType, outputIdx);
                newOutput.isReroute = true;
            }
            for (let i = 0; i < (node.outputs ?? []).length; i++) {
                if (!isOutputInternal(node, i, linksMapping)) outputIdx++;
            }
        }
    }


    // Inherit the links of its serialized workflow, 
    // must be before the nodes that are being nested are removed from the graph
    inheritLinks() {
        const linksMapping = this.linksMapping;
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
        const serialized = this.nestedNodes;
        const linksMapping = this.linksMapping;
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
                        return this.getNumDefinedInputs() + convertedSlotIdx;
                    }
                    if (!isInputInternal(node, inputIdx, linksMapping)) {
                        convertedSlotIdx++;
                    }
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
        const serialized = this.nestedNodes;
        let slotIdx = 0;

        const linksMapping = this.linksMapping;
        for (const i in serialized) {
            const node = serialized[i];
            if (node.id === internalNodeId) {
                let numInternalOutputs = 0;
                // The slot internalSlotId should be non-internal if it is included in the nested node
                for (let j = 0; j < internalSlotId; j++) {
                    if (isOutputInternal(node, j, linksMapping)) {
                        numInternalOutputs++;
                    }
                }
                return slotIdx + internalSlotId - numInternalOutputs;
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
        const serializedWorkflow = this.nestedNodes;
        this.linksMapping = mapLinksToNodes(serializedWorkflow);
        const linksMapping = this.linksMapping;
        // Add the nodes inside the nested node
        const nestedNodes = [];
        const internalOutputList = [];
        const internalInputList = [];
        const avgPos = averagePos(serializedWorkflow);
        const serializedToNodeMapping = {};
        for (const idx in serializedWorkflow) {
            const serializedNode = serializedWorkflow[idx];
            const node = LiteGraph.createNode(serializedNode.type);

            // Fix for Primitive nodes, which check for the existence of the graph
            node.graph = app.graph;
            // Fix for Reroute nodes, which executes code if it has a link, but the link wouldn't be valid here.
            let rerouteInputLink = null;
            let rerouteOutputLinks = null;
            if (node.type === "Reroute") {
                rerouteInputLink = serializedNode.inputs[0].link;
                if (serializedNode.outputs[0].links) {
                    rerouteOutputLinks = serializedNode.outputs[0].links.slice();
                }
                serializedNode.inputs[0].link = null;
                serializedNode.outputs[0].links = [];
            }
            // Configure the node
            node.configure(serializedNode);
            // Restore links from Reroute node fix
            if (node.type === "Reroute") {
                serializedNode.inputs[0].link = rerouteInputLink;
                if (rerouteOutputLinks) {
                    serializedNode.outputs[0].links = rerouteOutputLinks;
                }
            }

            const dx = serializedNode.pos[0] - avgPos[0];
            const dy = serializedNode.pos[1] - avgPos[1];
            node.pos = [this.pos[0] + dx, this.pos[1] + dy];

            const isInputsInternal = [];
            for (let i = 0; i < (serializedNode.inputs ?? []).length; i++) {
                isInputsInternal.push(isInputInternal(serializedNode, i, linksMapping));
            }
            internalInputList.push(isInputsInternal);

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
        let nestedConvertedWidgetSlot = this.getNumDefinedInputs();
        // Assuming that the order of inputs and outputs of each node of the nested workflow 
        // is in the same order as the inputs and outputs of the nested node
        for (const i in nestedNodes) {
            const node = nestedNodes[i];
            for (let inputSlot = 0; inputSlot < (node.inputs ?? []).length; inputSlot++) {
                // Out of bounds, rest of the inputs are not connected to the outside
                if (nestedInputSlot >= (this.inputs ?? []).length) {
                    break;
                }
                // If the input is only connected internally, then skip
                if (internalInputList[i][inputSlot]) {
                    continue;
                }
                // If types don't match, then skip this input
                // Must take into account reroute node wildcard inputs
                let isRerouteMatching = false;
                if (node.type === "Reroute") {
                    const rerouteType = node.outputs[0].name;
                    isRerouteMatching = rerouteType === this.inputs[nestedInputSlot].type;
                    isRerouteMatching = isRerouteMatching || rerouteType === "*";
                }
                if (node.inputs[inputSlot].type !== this.inputs[nestedInputSlot].type && !isRerouteMatching) {
                    continue;
                }
                const link = this.getInputLink(nestedInputSlot);
                if (link) { // Just in case
                    const originNode = app.graph.getNodeById(link.origin_id);
                    originNode.connect(link.origin_slot, node, inputSlot);
                }
                nestedInputSlot++;
            }
            // Connect converted widget inputs
            for (let inputSlot = 0; inputSlot < (node.inputs ?? []).length; inputSlot++) {
                // Out of bounds, rest of the inputs are not connected to the outside
                if (nestedConvertedWidgetSlot >= (this.inputs ?? []).length) {
                    break;
                }
                if (node.inputs[inputSlot].type !== this.inputs[nestedConvertedWidgetSlot].type) {
                    continue;
                }
                // If the input is only connected internally, then skip
                if (internalInputList[i][inputSlot]) {
                    continue;
                }
                const link = this.getInputLink(nestedConvertedWidgetSlot);
                if (link) { // Just in case
                    const originNode = app.graph.getNodeById(link.origin_id);
                    originNode.connect(link.origin_slot, node, inputSlot);
                }
                nestedConvertedWidgetSlot++;
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
                const toConnect = []; // To avoid invalidating the iterator
                for (const linkId of links ?? []) {
                    const link = app.graph.links[linkId];
                    if (link) {
                        const targetNode = app.graph.getNodeById(link.target_id);
                        toConnect.push({ node: targetNode, slot: link.target_slot });
                    }
                }
                for (const { node: targetNode, slot: targetSlot } of toConnect) {
                    node.connect(outputSlot, targetNode, targetSlot);
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
        for (let inputSlot = 0; inputSlot < (this.inputs ?? []).length; inputSlot++) {
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
    const originalName = widget.name.replace(/_\d+$/, '');
    return nodeData?.input?.required[originalName] || nodeData?.input?.optional?.[originalName] || [widget.type, widget.options || {}];
}