import {app} from "../../scripts/app.js";
import {nodeName} from "./nestedNode.js";

const ext = {
    name: "SS.NestedNodeBuilder",

    nodeCreated(node, app) {
        //
        // Editing menu options for the node
        //
        // Save the original options
        const getBaseMenuOptions = node.getExtraMenuOptions;
        node.getExtraMenuOptions = function (_, options) {
            // Call the original function for the default menu options
            getBaseMenuOptions.call(this, _, options);

            // Add new menu options for this extension
            options.push({
                content: "Nest Selected Nodes", callback: () => {
                    ext.nestSelectedNodes();
                }
            });

            // Add a separator
            options.push(null);
        };
    },

    nestSelectedNodes() {
        // Use the selected nodes for the nested node
        const selectedNodes = app.canvas.selected_nodes;

        // Create the nested node
        const nestedNode = LiteGraph.createNode(nodeName);
        nestedNode.nestWorkflow(selectedNodes);
        app.graph.add(nestedNode);
    }
};

app.registerExtension(ext);
