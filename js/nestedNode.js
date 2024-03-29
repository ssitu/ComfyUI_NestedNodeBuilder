import { app } from "../../scripts/app.js";
import { mapLinksToNodes, isOutputInternal, isInputInternal, nodeDefs } from "./nodeMenu.js";

// Node that allows you to convert a set of nodes into a single node
export const nestedNodeType = "NestedNode";
export const nestedNodeTitle = "Nested Node";

// Identifier used to prevent the user from changing input back to widget (if the widget is used as an input that is internal to the nested node).
const HIDDEN_CONVERTED_TYPE = "hidden-converted-widget";
// Identifier used to distinguish converted widgets from ones inherited from nodes within the nested node (Prevent widgetInputs.js from removing the converted input on load).
const INHERITED_CONVERTED_TYPE = "inherited-converted-widget";


export function serializeWorkflow(workflow) {
    let nodes = [];
    for (const id in workflow) {
        const node = workflow[id];
        let serialized = LiteGraph.cloneObject(node.serialize());

        // Add widgets to the serialization
        serialized.serializedWidgets = [];
        for (const widgetIdx in node.widgets) {
            const { ...widget } = node.widgets[widgetIdx];
            // Remove possible circular reference (text boxes have a reference to the parent)
            delete widget.parent;
            serialized.serializedWidgets.push(LiteGraph.cloneObject(widget));
        }

        nodes.push(serialized);
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

export function getRerouteName(rerouteNode) {
    const input = rerouteNode.inputs[0];
    const output = rerouteNode.outputs[0];
    return input.label || output.label || output.type;
}

export class NestedNode {

    get nestedNodes() {
        return this.properties.nestedData.nestedNodes;
    }

    nestedNodeSetup() {
        // Called every time a nested node is loaded
        console.log("[NestedNodeBuilder] Nested node setup")
        this.addWidgetListeners();
        this.nestedNodeIdMapping = arrToIdMap(this.nestedNodes);
        this.linksMapping = mapLinksToNodes(this.nestedNodes);

        this.inheritRerouteNodeInputs();
        this.inheritRerouteNodeOutputs();
        this.inheritFrontendWidgets();
        this.inheritConvertedWidgets();
        this.inheritPrimitiveWidgets();
        this.widgetMapping = this.createWidgetMapping();

        this.renameInputs();
        this.resizeNestedNode();
        this.inheritWidgetValues();


        // Prevent widgetInputs.js from changing the widget type
        const origOnConfigure = this.onConfigure;
        this.onConfigure = function () {
            const widgets = [];
            for (const input of this.inputs ?? []) {
                // If input is from a widget, then save it and remove it from the input
                if (input.isInherited || (input.isReroute && input.widget)) {
                    widgets.push(input.widget);
                    input.widget = undefined;
                } else {    // Otherwise, add a null entry to keep the indices the same
                    widgets.push(null);
                }
            }
            // Let widgetInputs.js do its thing
            const r = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
            // Restore the widgets
            for (let i = 0; i < (this.inputs ?? []).length; i++) {
                if (widgets[i]) {
                    this.inputs[i].widget = widgets[i];
                }
            }
            return r;
        };
    }

    onAdded() {
        if (!this.isSetup) {
            this.nestedNodeSetup();
            this.isSetup = true;
        }
    }

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        // Called when user makes a nested node
        console.log("[NestedNodeBuilder] Nesting workflow")
        // Node setup
        this.properties.nestedData = { nestedNodes: serializeWorkflow(workflow) };
        this.linksMapping = mapLinksToNodes(this.nestedNodes);
        this.placeNestedNode(workflow);
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

    inheritWidgetValues() {
        // Inherit the widget values of the serialized workflow
        const serialized = this.nestedNodes;
        const widgetMapping = this.widgetMapping;
        for (const widgetIdx in widgetMapping) {
            const widget = this.widgets[widgetIdx];
            const { nodeIdx, widgetIdx: widgetIdx2 } = widgetMapping[widgetIdx];
            const node = serialized[nodeIdx];
            widget.value = node.widgets_values[widgetIdx2];
        }
    }

    createInputMappings() {
        // Map nodes inside the nesting to the starting index of their inputs in the nesting and the end index of the start of the next node's inputs
        // key: node id, value: { startIdx, endIdx }
        const serialized = this.nestedNodes;
        const linksMapping = this.linksMapping;
        const result = {};
        let inputIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            const nodeInputs = node.inputs ?? [];
            let numInternalInputs = 0;
            for (let inputIdx = 0; inputIdx < nodeInputs.length; inputIdx++) {
                if (isInputInternal(node, inputIdx, linksMapping)) {
                    numInternalInputs++;
                }
            }
            result[node.id] = { startIdx: inputIdx, endIdx: inputIdx + nodeInputs.length - numInternalInputs };
            inputIdx += nodeInputs.length - numInternalInputs;
        }
        return result;
    }

    inheritRerouteNodeInputs() {
        // Inherit the inputs of reroute nodes, since they are not added
        // to the node definition so they must be added manually.

        let inputIdx = 0;
        const serialized = this.nestedNodes;
        const linksMapping = this.linksMapping;
        for (const node of serialized) {
            if (node.type === "Reroute" && !this.inputs?.[inputIdx]?.isReroute && !isInputInternal(node, 0, linksMapping)) {
                // Allow the use of titles on reroute nodes for custom input names
                const rerouteType = node.outputs[0].type;
                const inputName = getRerouteName(node);
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
                const rerouteType = node.outputs[0].type;
                const outputName = getRerouteName(node);
                const newOutput = this.insertOutput(outputName, rerouteType, outputIdx);
                newOutput.isReroute = true;
            }
            for (let i = 0; i < (node.outputs ?? []).length; i++) {
                if (!isOutputInternal(node, i, linksMapping)) outputIdx++;
            }
        }
    }

    inheritFrontendWidgets() {
        // Inherit the frontend widgets of the serialized workflow, which shows up after the specific node's construction
        const serialized = this.nestedNodes;
        let nestedWidgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            // Skip primitive nodes, deal with them in another method
            if (node.type === "PrimitiveNode") {
                continue;
            }
            const tempNode = LiteGraph.createNode(node.type);
            if (!tempNode) {
                console.log("[NestedNodeBuilder] Node not found", node.type);
                continue;
            }
            const nodeDef = nodeDefs[node.type];
            const widgets = node?.serializedWidgets ?? [];
            for (const widgetIdx in widgets) {
                const widget = widgets[widgetIdx];
                const tempWidget = tempNode?.widgets?.[widgetIdx];
                const isWidgetInDef = nodeDef?.input?.required?.[widget.name] || nodeDef?.input?.optional?.[widget.name];
                if (!isWidgetInDef && tempWidget) {
                    // This widget is a frontend widget
                    this.widgets.splice(nestedWidgetIdx, 0, tempWidget);
                    // Check if this is a linked widget
                    const parentWidgetIdx = node.serializedWidgets?.findIndex(w => w?.linkedWidgets?.map(v => v.name)?.includes(widget.name));
                    if (parentWidgetIdx !== undefined && parentWidgetIdx !== -1) {
                        // This is a linked widget, find the corresponding widget in the nesting
                        const start = nestedWidgetIdx - widgetIdx;
                        const nestedParentWidgetIdx = start + parentWidgetIdx;
                        const nestedParentWidget = this.widgets[nestedParentWidgetIdx];
                        // Link the widgets
                        nestedParentWidget.linkedWidgets = nestedParentWidget.linkedWidgets ?? [];
                        nestedParentWidget.linkedWidgets.push(tempWidget);
                    }
                        
                    // If the widget is linked and supposed to be converted, then hide it
                    if (widget.type.startsWith(CONVERTED_TYPE + ":")) {
                        const parentWidgetName = widget.type.split(":")[1];
                        hideWidget(this, tempWidget, ":" + parentWidgetName);
                    }
                }

                nestedWidgetIdx++;
            }
        }
    }

    inheritConvertedWidgets() {
        let nestedWidgetIdx = 0;
        for (const nodeIdx in this.nestedNodes) {
            const node = this.nestedNodes[nodeIdx];
            const convertedInputs = {};
            // Skip primitive nodes, deal with them in another method
            if (node.type === "PrimitiveNode") {
                continue;
            }
            for (const widgetIdx in node.serializedWidgets) {
                const widget = node.serializedWidgets[widgetIdx];
                const config = getConfig(nodeDefs[node.type], widget);
                const nestedWidget = this?.widgets?.[nestedWidgetIdx];
                if (!nestedWidget) {
                    nestedWidgetIdx++;
                    continue;
                }
                // Skip widgets that have already been converted (Prevent duplicate inputs when cloning the node)
                if (nestedWidget.type === CONVERTED_TYPE || nestedWidget.type === HIDDEN_CONVERTED_TYPE || nestedWidget.type === INHERITED_CONVERTED_TYPE) {
                    nestedWidgetIdx++;
                    continue;
                }
                if (widget.type === CONVERTED_TYPE) {
                    convertToInput(this, nestedWidget, config);
                    // Find index of the input of the node in the nesting that maps to the converted widget input
                    const inputIdx = node.inputs.findIndex(input => input.name === widget.name);
                    if (isInputInternal(node, inputIdx, this.linksMapping)) {
                        // Input from converted widget is internal, so remove it and completely hide the widget
                        this.inputs.pop();
                        nestedWidget.type = HIDDEN_CONVERTED_TYPE;
                    } else {
                        // Input from converted widget is external, so keep it and mark it as inherited
                        nestedWidget.type = INHERITED_CONVERTED_TYPE;
                        this.inputs.at(-1).isInherited = true;
                        // Remove the converted input and store for later
                        const convertedInput = this.inputs.pop();
                        convertedInputs[node.inputs[inputIdx].name] = convertedInput;
                    }
                }
                nestedWidgetIdx++;
            }
            // Add the converted inputs back in the correct order
            const startIdx = node?.inputs?.findIndex(input => input?.widget);
            if (startIdx !== undefined && startIdx !== -1) {
                for (let i = startIdx; i < node.inputs.length; i++) {
                    const input = node.inputs[i];
                    const convertedInput = convertedInputs[input.name];
                    if (convertedInput) {
                        const nestedInputIdx = this.getNestedInputSlot(node.id, i);
                        this.inputs.splice(nestedInputIdx, 0, convertedInput);
                    }
                }
            }
        }
    }

    inheritPrimitiveWidgets() {
        const serialized = this.nestedNodes;
        const linksMapping = this.linksMapping;
        let widgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            // Create a temporary node to get access to primitive node widgets
            const tempNode = LiteGraph.createNode(node.type);
            if (tempNode !== null && tempNode.type == "PrimitiveNode" && node.outputs[0].links) {
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
                this.widgets.splice(widgetIdx, 0, widget);
                widgetIdx++;
            } else {
                widgetIdx += (node.widgets_values ?? []).length;
            }
        }
    }

    createWidgetMapping() {
        // Map nested widget index to serialized node index and widget index
        const serialized = this.nestedNodes;
        const widgetMapping = {};
        let widgetIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            for (const j in node.widgets_values) {
                const nestedWidget = this.widgets?.[widgetIdx];
                if (!nestedWidget) break;
                if (node.type === "PrimitiveNode") {
                    widgetMapping[widgetIdx] = { nodeIdx: i, widgetIdx: j };
                    widgetIdx++;
                    // Skip the rest of the widgets of the primitive node, only care about the value widget
                    break;
                }
                widgetMapping[widgetIdx] = { nodeIdx: i, widgetIdx: j };
                widgetIdx++;

            }
        }
        return widgetMapping;
    }

    updateSerializedWorkflow() {
        // Update the serialized workflow with the current values of the widgets
        const mapping = this.widgetMapping;
        const serialized = this.nestedNodes;
        for (const widgetIdx in mapping) {
            const widget = this.widgets[widgetIdx];
            const { nodeIdx, widgetIdx: widgetIdx2 } = mapping[widgetIdx];
            const node = serialized[nodeIdx];
            node.widgets_values[widgetIdx2] = widget.value;
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
        this.updateSerializedWorkflow();
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
                const dst = app.graph.getNodeById(link?.target_id);
                const srcSlot = this.getNestedOutputSlot(entry.srcId, entry.srcSlot);
                this.connect(srcSlot, dst, link?.target_slot);
            }
        }
    }

    getNestedInputSlot(internalNodeId, internalSlotId) {
        // Converts a node slot that was nested into a slot of the resulting nested node.
        const serialized = this.nestedNodes;
        const linksMapping = this.linksMapping;
        let slotIdx = 0;
        for (const i in serialized) {
            const node = serialized[i];
            const nodeInputs = node.inputs ?? [];
            for (let inputIdx = 0; inputIdx < nodeInputs.length; inputIdx++) {
                const isCorrectSlot = node.id === internalNodeId && inputIdx === internalSlotId;
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
            let node = LiteGraph.createNode(serializedNode.type);
            let rerouteInputLink = null;
            let rerouteOutputLinks = null;
            if (node) {
                // Fix for Primitive nodes, which check for the existence of the graph
                node.graph = app.graph;
                // Fix for Reroute nodes, which executes code if it has a link, but the link wouldn't be valid here.
                if (node.type === "Reroute") {
                    rerouteInputLink = serializedNode.inputs[0].link;
                    if (serializedNode.outputs[0].links) {
                        rerouteOutputLinks = serializedNode.outputs[0].links.slice();
                    }
                    serializedNode.inputs[0].link = null;
                    serializedNode.outputs[0].links = [];
                }
            } else {
                // Create an empty missing node, use same code as LiteGraph
                node = new LiteGraph.LGraphNode();
                node.last_serialization = serializedNode;
                node.has_errors = true;
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
                    const rerouteType = node.__outputType;  // Property that reroutes have
                    isRerouteMatching = rerouteType === this.inputs[nestedInputSlot].type;
                    isRerouteMatching = isRerouteMatching || rerouteType === undefined;  // Unconnected Reroute
                }
                const dstName = node.type === "Reroute" ? getRerouteName(node) : node.title;
                let matchingTypes = node.inputs[inputSlot].type === this.inputs[nestedInputSlot].type;
                matchingTypes ||= isRerouteMatching;
                if (!matchingTypes) {
                    continue;
                }
                const link = this.getInputLink(nestedInputSlot);
                if (link) { // Just in case
                    const originNode = app.graph.getNodeById(link.origin_id);
                    const srcName = originNode.type === "Reroute" ? getRerouteName(originNode) : originNode.title;
                    originNode.connect(link.origin_slot, node, inputSlot);
                }
                nestedInputSlot++;
            }
            // Links the outputs of the nested node to the nodes outside the nested node
            for (let outputSlot = 0; outputSlot < (node.outputs ?? []).length; outputSlot++) {
                // Out of bounds, rest of the outputs are not connected to the outside
                if (nestedOutputSlot >= (this.outputs ?? []).length) {
                    break;
                }
                // If types don't match, then skip this output
                // Allow wildcard matches for reroute nodes
                const isWildcardMatching = node.outputs[outputSlot].type === "*" || this.outputs[nestedOutputSlot].type === "*";
                if (!isWildcardMatching && node.outputs[outputSlot].type !== this.outputs[nestedOutputSlot].type) {
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

//
// Copied from ./web/extensions/core/widgetInputs.js
//
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