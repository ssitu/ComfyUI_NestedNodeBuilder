import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { NestedNode, serializeWorkflow } from "./nestedNode.js";
import { ComfirmDialog, showWidgetDialog } from "./dialog.js";
import { Queue } from "./queue.js";

export let nodeDefs = {};

export const ext = {
    name: "SS.NestedNodeBuilder",
    nestedDef: {},
    nestedNodeDefs: {},
    comfirmationDialog: new ComfirmDialog(),
    nestedPromptQueue: new Queue([null]),

    async setup(app) {
        // Extend queuePrompt behavior
        const originalQueuePrompt = app.queuePrompt;
        app.queuePrompt = async function (number, batchsize) {
            const nestedNodesUnnested = {};
            const nestedNodes = [];
            const connectedInputNodes = [];
            // Unnest all nested nodes
            const nodes = app.graph._nodes;
            for (const i in nodes) {
                const node = nodes[i];
                if (node.properties.nestedData) {
                    node.beforeQueuePrompt();
                    nestedNodes.push(node);
                    connectedInputNodes.push(node.getConnectedInputNodes());
                    // Unnest the nested node
                    const unnestedNodes = node.unnest();
                    nestedNodesUnnested[node.id] = unnestedNodes;
                }
            }

            // Call the original function
            await originalQueuePrompt.call(this, number, batchsize);

            // Renest all nested nodes
            let i = 0;
            for (const nestedId in nestedNodesUnnested) {
                const unnestedNodes = nestedNodesUnnested[nestedId];
                const node = nestedNodes[i];

                // Readd the node to the graph
                app.graph.add(node);

                // Renest the node using the unnested nodes
                node.nestWorkflow(unnestedNodes);

                // Reconnect missing links
                const inputNodes = connectedInputNodes[i];
                const currentConnectedInputNodes = node.getConnectedInputNodes();
                let currentIdx = 0;
                for (const inputIdx in inputNodes) {
                    const inputData = inputNodes[inputIdx];
                    const currentInputData = currentConnectedInputNodes[currentIdx];
                    if (inputData.node.id === currentInputData?.node.id) {
                        // Increment the current index
                        currentIdx++;
                        continue;
                    } // Otherwise, the link is missing
                    // Reconnect the link
                    const srcSlot = inputData.srcSlot;
                    const dstSlot = inputData.dstSlot;
                    inputData.node.connect(srcSlot, node, dstSlot);
                }

                // Readd widget elements to the canvas
                for (const widget of node.widgets ?? []) {
                    if (widget.inputEl) {
                        document.body.appendChild(widget.inputEl);
                    }
                }

                // Call resize listeners to fix overhanging widgets
                node.setSize(node.size);

                // Increment the index
                i++;
            }

            //
            // Add the pre-unnested workflow to the queue
            //
            // Create a mapping of unnested node ids to the encapsulating nested node id
            const unnestedToNestedIds = {};
            for (const nestedId in nestedNodesUnnested) {
                const unnestedNodes = nestedNodesUnnested[nestedId];
                for (const unnestedNode of unnestedNodes) {
                    unnestedToNestedIds[unnestedNode.id] = nestedId;
                }
            }
            // Add the mapping to the queue
            ext.nestedPromptQueue.enqueue(unnestedToNestedIds);
        }

        // Redirect the executing event to the nested node if the executing node is nested
        api.addEventListener("executing", ({ detail }) => {
            const unnestedToNestedIds = ext.nestedPromptQueue.peek();
            if (unnestedToNestedIds?.[detail]) {
                app.runningNodeId = unnestedToNestedIds[detail];
            }
        });

        // Remove the last prompt from the queue
        api.addEventListener("execution_start", ({ detail }) => {
            this.nestedPromptQueue.dequeue();
        });

    },

    /**
     * Called before the app registers nodes from definitions.
     * Used to add nested node definitions.
     * @param defs The node definitions.
     * @param app The app.
     * @returns {Promise<void>}
     */
    async addCustomNodeDefs(defs, app) {
        // Save definitions for reference
        nodeDefs = defs;
        // Grab nested node definitions
        const resp = await fetch("/nested_node_defs")
        const nestedNodeDefs = await resp.json();
        // Merge nested node definitions
        Object.assign(this.nestedNodeDefs, nestedNodeDefs);
        // Add nested node definitions if they exist
        Object.assign(defs, this.nestedNodeDefs);


    },

    /**
     * Called after inputs, outputs, widgets, menus are added to the node given the node definition.
     * Used to add methods to nested nodes.
     * @param nodeType The ComfyNode object to be registered with LiteGraph.
     * @param nodeData The node definition.
     * @param app The app.
     * @returns {Promise<void>}
     */
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // Return if the node is not a nested node
        let isNestedNode = false;
        for (const defName in this.nestedNodeDefs) {
            if (defName === nodeData.name) {
                isNestedNode = true;
                break;
            }
        }
        if (!isNestedNode) {
            return;
        }

        // Add Nested Node methods to the node ComfyNode
        const nestedNodePrototype = NestedNode.prototype;
        for (const key of Object.getOwnPropertyNames(nestedNodePrototype)) {
            nodeType.prototype[key] = nestedNodePrototype[key];
        }

        // Add the nested node data to the node properties
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            if (!this.properties || !("nestedData" in this.properties)) {
                this.addProperty("nestedData", nodeData.description, "object");
            }
            return result;
        }
    },

    /**
     * Called when loading a graph from a JSON file or pasted into the app.
     * @param node The node that was loaded.
     * @param app The app.
     */
    loadedGraphNode(node, app) {
        // Return if the node is not a nested node
        if (!node.properties.nestedData) {
            return;
        }

        // Return if a nested node definition with the same name already exists
        if (this.nestedNodeDefs[node.type]) {
            return;
        }

        // Use the serialized workflow to create a nested node definition
        const nestedDef = this.createNestedDef(node.properties.nestedData.nestedNodes, node.type);

        //
        // If the definition already exists, then the node will be loaded with the existing definition
        //
        for (const defName in this.nestedNodeDefs) {
            const def = this.nestedNodeDefs[defName];
            if (def.name === nestedDef.name) {
                return;
            }
        }

        //
        // When the nested node is loaded but missing def, it can still work.
        // Might remove this in the future.
        //
        console.log("[NestedNodeBuilder] def for nested node not found, adding temporary def:", nestedDef);

        // Add the def
        this.nestedNodeDefs[nestedDef.name] = nestedDef;
        // Reload the graph
        LiteGraph.registered_node_types = {};
        app.registerNodes().then(() => {
            // Reload the graph data
            app.loadGraphData(app.graph.serialize());
        }, (error) => {
            console.log("Error registering nodes:", error);
        });
    },

    /**
     * Called when a node is created. Used to add menu options to nodes.
     * @param node The node that was created.
     * @param app The app.
     */
    nodeCreated(node, app) {
        // Save the original options
        const getBaseMenuOptions = node.getExtraMenuOptions;
        // Add new options
        node.getExtraMenuOptions = function (_, options) {
            // Call the original function for the default menu options
            getBaseMenuOptions.call(this, _, options);

            // Add new menu options for this extension
            options.push({
                content: "Nest Selected Nodes", callback: () => {
                    ext.onMenuNestSelectedNodes();
                }
            });

            // Add a menu option to nest the selected nodes if there is a nested node definition with the same structure
            const selectedNodes = app.canvas.selected_nodes;
            const serializedWorkflow = serializeWorkflow(selectedNodes);
            for (const defName in ext.nestedNodeDefs) {
                const def = ext.nestedNodeDefs[defName];
                if (isStructurallyEqual(def.description.nestedNodes, serializedWorkflow)) {
                    options.push({
                        content: `Convert selected to Nested Node: ${defName}`, callback: () => {
                            ext.nestSelectedNodes(selectedNodes, defName);
                        }
                    });
                }
            }

            // Nested Node specific options
            if (this.properties.nestedData) {
                // Add a menu option to unnest the node
                options.push({
                    content: "Unnest", callback: () => {
                        this.unnest();
                    }
                });
            }

            // End with a separator
            options.push(null);
        };
    },

    createNestedDef(serializedWorkflow, uniqueName) {
        // Replace spaces with underscores for the type
        const uniqueType = uniqueName.replace(/\s/g, "_");
        let nestedDef = {
            name: uniqueType,
            display_name: uniqueName,
            category: "Nested Nodes",
            description: {
                nestedNodes: serializedWorkflow
            },
            input: {},
            output: [],
            output_is_list: [],
            output_name: [],
        };
        // Create a mapping of links
        const linksMapping = mapLinksToNodes(serializedWorkflow);
        // Inherit inputs and outputs for each node
        for (const id in serializedWorkflow) {
            const node = serializedWorkflow[id];
            const nodeDef = nodeDefs[node.type];
            // Inherit inputs
            inheritInputs(node, nodeDef, nestedDef, linksMapping);
            // Inherit outputs
            inheritOutputs(node, nodeDef, nestedDef, linksMapping);
        }
        return nestedDef;
    },

    createNestSelectedDialog(selectedNodes) {
        const pos = [window.innerWidth / 3, 2 * window.innerHeight / 3];
        const enterName = (input) => {
            // Check if the name already exists in the defs
            const name = input.value;
            if (name in this.nestedNodeDefs) {
                this.comfirmationDialog.show(
                    `The name "${name}" is already used for a nested node. Do you want to overwrite it?`,
                    () => {
                        // Overwrite the nested node
                        this.nestSelectedNodes(selectedNodes, name);
                    },
                    () => {
                        // Do not overwrite the nested node
                        return;
                    }
                );
            } else {
                // Successfully entered a valid name
                this.nestSelectedNodes(selectedNodes, name);
            }
        }
        showWidgetDialog(pos, enterName);
    },

    onMenuNestSelectedNodes() {
        // Use the selected nodes for the nested node
        const selectedNodes = app.canvas.selected_nodes;

        // Prompt user to enter name for the node type
        this.createNestSelectedDialog(selectedNodes);
    },

    nestSelectedNodes(selectedNodes, uniqueName) {
        // Add a custom definition for the nested node
        const nestedDef = this.createNestedDef(serializeWorkflow(selectedNodes), uniqueName);

        // Add the def, this will be added to defs in addCustomNodeDefs
        this.nestedNodeDefs[nestedDef.name] = nestedDef;

        // Download the nested node definition
        saveDef(nestedDef).then(
            (successful) => {
                // Register nodes again to add the nested node definition
                LiteGraph.registered_node_types = {};
                app.registerNodes().then(() => {
                    // Create the nested node
                    const nestedNode = LiteGraph.createNode(nestedDef.name);
                    app.graph.add(nestedNode);
                    nestedNode.nestWorkflow(selectedNodes);

                    // Add new node to selection
                    app.canvas.selectNode(nestedNode, true);
                }, (error) => {
                    console.log("Error registering nodes:", error);
                });
            },
            (error) => {
                app.ui.dialog.show(`Was unable to save the nested node. Check the console for more details.`);
            }
        );
    },

    mapLinks(selectedNodes) {
        const serializedWorkflow = serializeWorkflow(selectedNodes);
        return mapLinksToNodes(serializedWorkflow);
    }

};

app.registerExtension(ext);

async function saveDef(nestedDef) {
    // Save by sending to server
    const request = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(nestedDef)
    };
    console.log("[NestedNodeBuilder] Saving nested node def:", nestedDef);
    const response = await fetch("/nested_node_defs", request);
    return response.status === 200;
}

export function mapLinksToNodes(serializedWorkflow) {
    // Mapping
    const links = {};
    // Iterate over nodes and add links to mapping
    for (const node of serializedWorkflow) {
        // Add the destination node id for each link
        for (const inputIdx in node.inputs ?? []) {
            const input = node.inputs[inputIdx];
            // input.link is either null or a link id
            if (input.link === null) {
                continue;
            }
            // Add the link entry if it doesn't exist
            if (links[input.link] === undefined) {
                links[input.link] = {};
            }
            // Set the destination node id
            links[input.link].dstId = node.id;
            // Set the destination slot
            links[input.link].dstSlot = Number(inputIdx);
        }
        // Add the source node id for each link
        for (const outputIdx in node.outputs ?? []) {
            const output = node.outputs[outputIdx];
            // For each link, add the source node id
            for (const link of output.links ?? []) {
                // Add the link entry if it doesn't exist
                if (links[link] === undefined) {
                    links[link] = {};
                }
                // Set the source node id
                links[link].srcId = node.id;
                // Set the source slot
                links[link].srcSlot = Number(outputIdx);
            }
        }
    }
    return links;
}

function inheritInputs(node, nodeDef, nestedDef, linkMapping) {
    // For each input from nodeDef, add it to the nestedDef if the input is connected
    // to a node outside the serialized workflow
    for (const inputType in (nodeDef?.input) ?? []) { // inputType is required, optional, etc.
        // Add the input type if it doesn't exist
        if (!(inputType in nestedDef.input)) {
            nestedDef.input[inputType] = {};
        }
        let linkInputIdx = 0;
        for (const inputName in nodeDef.input[inputType]) {
            // Change the input name if it already exists
            let uniqueInputName = inputName;
            let i = 2;
            while (uniqueInputName in nestedDef.input[inputType]) {
                uniqueInputName = inputName + "_" + i;
                i++;
            }
            const isRemainingWidgets = node.inputs === undefined || linkInputIdx >= node.inputs.length;
            if (isRemainingWidgets || inputName !== node.inputs[linkInputIdx].name) {
                // This input is a widget, add by default
                nestedDef.input[inputType][uniqueInputName] = nodeDef.input[inputType][inputName];
                continue;
            }

            // Add the input if it is not connected to a node within the serialized workflow
            if (!isInputInternal(node, linkInputIdx, linkMapping)) {
                nestedDef.input[inputType][uniqueInputName] = nodeDef.input[inputType][inputName];
            }
            linkInputIdx++;
        }
    }
}

export function isInputInternal(node, inputIdx, linkMapping) {
    // Keep input if no link
    const link = node.inputs[inputIdx].link;
    if (link === null) {
        return false;
    }
    // Keep input if link is connected to a node outside the nested workflow
    const entry = linkMapping[link];
    if (entry.srcId === undefined) {
        // This input is connected to a node outside the nested workflow
        return false;
    }
    return true;
}

export function isOutputInternal(node, outputIdx, linkMapping) {
    // Keep output if no links
    const links = node.outputs[outputIdx].links;
    if (links === null || links.length === 0) {
        return false;
    }
    // Keep output if any link is connected to a node outside the nested workflow
    for (const link of links) {
        const entry = linkMapping[link];
        if (entry.dstId === undefined) {
            // This output is connected to a node outside the nested workflow
            return false;
        }
    }
    return true;
}

function inheritOutputs(node, nodeDef, nestedDef, linksMapping) {
    // Somewhat similar to inheritInputs.
    // Outputs do not have a type, and they can connect to multiple nodes.
    // Inputs were either a link or a widget.
    // Only keep outputs that connect to nodes outside the nested workflow.
    for (const outputIdx in (nodeDef?.output) ?? []) {
        if (isOutputInternal(node, outputIdx, linksMapping)) {
            continue;
        }
        const defOutput = nodeDef.output[outputIdx];
        const defOutputName = nodeDef.output_name[outputIdx];
        const defOutputIsList = nodeDef.output_is_list[outputIdx];
        nestedDef.output.push(defOutput);
        nestedDef.output_name.push(defOutputName);
        nestedDef.output_is_list.push(defOutputIsList);
    }
}

export function isStructurallyEqual(nestedWorkflow1, nestedWorkflow2) {
    // Number of nodes must be the equal
    if (nestedWorkflow1.length !== nestedWorkflow2.length) {
        return false;
    }
    // Workflow is structurally equal if the numbers of each type of node is equal
    // and they are linked in the same way.

    // Number of each type of node must be equal
    const nodeTypeCount1 = {};
    const nodeTypeCount2 = {};
    for (const i in nestedWorkflow1) {
        const node1 = nestedWorkflow1[i];
        if (nodeTypeCount1[node1.type] === undefined) {
            nodeTypeCount1[node1.type] = 0;
        }
        nodeTypeCount1[node1.type]++;

        const node2 = nestedWorkflow2[i];
        if (nodeTypeCount2[node2.type] === undefined) {
            nodeTypeCount2[node2.type] = 0;
        }
        nodeTypeCount2[node2.type]++;
    }
    // Verify counts
    for (const type in nodeTypeCount1) {
        if (nodeTypeCount1[type] !== nodeTypeCount2[type]) {
            return false;
        }
    }

    // Check if the links are the same
    const linksMapping1 = mapLinksToNodes(nestedWorkflow1);
    const linksMapping2 = mapLinksToNodes(nestedWorkflow2);

    // Remove links that are not within the nested workflow
    for (const link in linksMapping1) {
        const entry = linksMapping1[link];
        if (entry.srcId === undefined || entry.dstId === undefined) {
            delete linksMapping1[link];
        }
    }
    for (const link in linksMapping2) {
        const entry = linksMapping2[link];
        if (entry.srcId === undefined || entry.dstId === undefined) {
            delete linksMapping2[link];
        }
    }

    // Get a mapping of ids to types
    const idToType1 = {};
    const idToType2 = {};
    for (const i in nestedWorkflow1) {
        const node1 = nestedWorkflow1[i];
        idToType1[node1.id] = node1.type;
        const node2 = nestedWorkflow2[i];
        idToType2[node2.id] = node2.type;
    }

    // Replace the ids with the type
    for (const link in linksMapping1) {
        const entry = linksMapping1[link];
        entry.srcId = idToType1[entry.srcId];
        entry.dstId = idToType1[entry.dstId];
    }
    for (const link in linksMapping2) {
        const entry = linksMapping2[link];
        entry.srcId = idToType2[entry.srcId];
        entry.dstId = idToType2[entry.dstId];
    }

    // Check if the links are the same
    for (const link1 in linksMapping1) {
        // Iterate over the links in the 2nd mapping and find a match
        let foundMatch = false;
        for (const link2 in linksMapping2) {
            const entry1 = linksMapping1[link1];
            const entry2 = linksMapping2[link2];
            if (entry1.srcId === entry2.srcId && entry1.dstId === entry2.dstId) {
                // Found a match, remove the entry from the 2nd mapping
                delete linksMapping2[link2];
                foundMatch = true;
                break;
            }
        }
        if (!foundMatch) {
            return false;
        }
    }
    return true;
}