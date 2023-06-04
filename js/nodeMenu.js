import { app } from "../../scripts/app.js";
import { NestedNode, serializeWorkflow } from "./nestedNode.js";
import { $el } from "../../scripts/ui.js";

export const ext = {
    name: "SS.NestedNodeBuilder", defs: {}, nestedDef: {}, nestedNodeDefs: {},

    /**
     * Called before the app registers nodes from definitions.
     * Used to add nested node definitions.
     * @param defs The node definitions.
     * @param app The app.
     * @returns {Promise<void>}
     */
    async addCustomNodeDefs(defs, app) {
        // Save definitions for reference
        this.defs = defs;
        // Grab nested node definitions
        const resp = await fetch("/nested_node_defs")
        const nestedNodeDefs = await resp.json();
        // Merge nested node definitions
        Object.assign(this.nestedNodeDefs, nestedNodeDefs);
        // Add nested node definitions if they exist
        Object.assign(defs, this.nestedNodeDefs);
        console.log("[NestedNodeBuilder] Added nested node definitions:", defs);
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
        nodeType.prototype.isVirtualNode = true;
        console.log("[NestedNodeBuilder] Added nested node methods:", nodeType.prototype);
    },

    /**
     * Called when loading a graph from a JSON file or pasted into the app.
     * @param node The node that was loaded.
     * @param app The app.
     */
    loadedGraphNode(node, app) {
        // Return if the node is not a nested node
        if (!node.properties.serializedWorkflow) {
            return;
        }

        // Return if a nested node definition with the same name already exists
        if (this.nestedNodeDefs[node.type]) {
            return;
        }

        // Use the serialized workflow to create a nested node definition
        const nestedDef = this.createNestedDef(node.properties.serializedWorkflow, node.type);
        console.log("[NestedNodeBuilder] loaded graph node, generated def", nestedDef);

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

            // Add a separator
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
            description: serializedWorkflow,
            input: {},
            output: [],
            output_is_list: [],
            output_name: [],
        };
        // Create a mapping of links
        const linksMapping = mapLinksToNodes(serializedWorkflow);
        // Create a list of node ids
        const nodesIdArr = [];
        for (const node of serializedWorkflow) {
            nodesIdArr.push(node.id);
        }
        // Inherit inputs and outputs for each node
        for (const id in serializedWorkflow) {
            const node = serializedWorkflow[id];
            const nodeDef = this.defs[node.type];
            // Inherit inputs
            inheritInputs(node, nodeDef, nestedDef, nodesIdArr, linksMapping);
            // Inherit outputs
            inheritOutputs(node, nodeDef, nestedDef, nodesIdArr, linksMapping);
        }
        return nestedDef;
    },

    createNestSelectedDialog(selectedNodes) {
        const pos = [window.innerWidth / 3, 2 * window.innerHeight / 3];
        let dialog = app.canvas.createDialog(
            "<span class='name'>Name for nested node:</span><input autofocus type='text' class='value'/><button>OK</button>",
            { position: pos }
        );
        let input = dialog.querySelector("input");
        const enterName = () => {
            // Check if the name already exists in the defs
            const name = input.value;
            if (name in this.nestedNodeDefs) {
                app.ui.dialog.show(`The name "${name}" is already used for a nested node. Please choose a different name.`);
                return;
            } else {
                // Successfully entered a valid name
                this.nestSelectedNodes(selectedNodes, name);
            }
            dialog.close();
        }
        input.addEventListener("keydown", function (e) {
            if (e.keyCode == 27) {
                //ESC
                dialog.close();
            } else if (e.keyCode == 13) {
                // ENTER
                enterName(); // save
            } else if (e.keyCode != 13) {
                dialog.modified();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        });
        let button = dialog.querySelector("button");
        button.addEventListener("click", enterName);
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
        const successful = saveDef(nestedDef);
        if (!successful) {
            app.ui.dialog.show(`Was unable to save the nested node. Check the console for more details.`);
            return;
        }

        // Register nodes again to add the nested node definition
        LiteGraph.registered_node_types = {};
        app.registerNodes().then(() => {
            // Create the nested node
            const nestedNode = LiteGraph.createNode(nestedDef.name);
            app.graph.add(nestedNode);
            nestedNode.nestWorkflow(selectedNodes);
        }, (error) => {
            console.log("Error registering nodes:", error);
        });
    }
};

app.registerExtension(ext);

function saveDef(nestedDef) {
    // // Save by downloading through browser
    // const json = JSON.stringify(nestedDef, null, 2); // convert the data to a JSON string
    // const blob = new Blob([json], { type: "application/json" });
    // const url = URL.createObjectURL(blob);
    // const a = $el("a", {
    //     href: url, download: nestedDef.name, style: { display: "none" }, parent: document.body,
    // });
    // a.click();
    // setTimeout(function () {
    //     a.remove();
    //     window.URL.revokeObjectURL(url);
    // }, 0);

    // Save by sending to server
    const request = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(nestedDef)
    };
    console.log("[NestedNodeBuilder] Saving nested node def:", nestedDef);
    fetch("/nested_node_defs", request).then(
        (response) => {
            console.log("[NestedNodeBuilder] Response:", response);
            if (response.status === 200) {
                return true;
            }
            return false;
        }
    );
}

function mapLinksToNodes(serializedWorkflow) {
    // Mapping
    const links = {};
    // Iterate over nodes and add links to mapping
    for (const node of serializedWorkflow) {
        // Add the destination node id for each link
        for (const input of node.inputs ?? []) {
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
        }
        // Add the source node id for each link
        for (const output of node.outputs ?? []) {
            // For each link, add the source node id
            for (const link of output.links) {
                // Add the link entry if it doesn't exist
                if (links[link] === undefined) {
                    links[link] = {};
                }
                // Set the source node id
                links[link].srcId = node.id;
            }
        }
    }
    return links;
}

function inheritInputs(node, nodeDef, nestedDef, nodesIdArr, linkMapping) {
    // For each input from nodeDef, add it to the nestedDef if the input is connected
    // to a node outside the serialized workflow
    for (const inputType in nodeDef.input) { // inputType is required, optional, etc.
        // Add the input type if it doesn't exist
        if (!(inputType in nestedDef.input)) {
            nestedDef.input[inputType] = {};
        }
        let linkInputIdx = 0;
        for (const inputName in nodeDef.input[inputType]) {
            const isRemainingWidgets = node.inputs === undefined || linkInputIdx >= node.inputs.length;
            if (isRemainingWidgets || inputName !== node.inputs[linkInputIdx].name) {
                // This input is a widget, add by default
                nestedDef.input[inputType][inputName] = nodeDef.input[inputType][inputName];
                continue;
            }
            // If the input is connected to a node within the serialized workflow,
            // then don't add it as an input.
            const link = node.inputs[linkInputIdx].link;
            const entry = linkMapping[link];
            if (link !== null && nodesIdArr.includes(entry.srcId)) {
                // This input is either not connected or
                // connected to a node within the serialized workflow
                // Do not add it as an input
            } else {
                // Else, input not linked or linked to an outside node, so inherit the input
                nestedDef.input[inputType][inputName] = nodeDef.input[inputType][inputName];
            }
            linkInputIdx++;
        }
    }
}


function inheritOutputs(node, nodeDef, nestedDef, nodesIdArr, linksMapping) {
    // Somewhat similar to inheritInputs.
    // Outputs do not have a type, and they can connect to multiple nodes.
    // Inputs were either a link or a widget.
    // Only keep outputs that connect to nodes outside the nested workflow.
    for (const outputIdx in nodeDef.output) {
        const links = node.outputs[outputIdx].links;
        // Keep output if no links
        let keepOutput = links === null || links.length === 0;
        for (const link of links ?? []) {
            const entry = linksMapping[link];
            if (entry.dstId === undefined) {
                // This output is connected to a node outside the nested workflow
                keepOutput = true;
                break;
            }
        }
        if (!keepOutput) {
            // This output is not connected to a node outside the nested workflow
            // So don't add it to the nested node
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


