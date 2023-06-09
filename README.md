# ComfyUI_NestedNodeBuilder
Adds a feature that allows for nesting of other nodes for better organization and simplification of repetitive patterns in workflows.

## Disclaimer
This is a prototype and will likely have many problems. This will probably be obsolete once [subgraphs](https://github.com/comfyanonymous/ComfyUI/pull/724) are implemented within ComfyUI. If you do decide to use this, make sure to save your workflow before nesting any nodes just in case. The way nested nodes are saved are subject to change and may become unusable in later commits.

## Installation
Enter the following command from the commandline starting in ComfyUI/custom_nodes/
```
git clone https://github.com/ssitu/ComfyUI_ComfyUI_NestedNodeBuilder
```

## Usage

### Selecting the nodes to nest
Select multiple nodes by using `Ctrl/Shift + left/right click` on the desired nodes to nest. 
You can also use `Ctrl + left click + drag` to highlight nodes.

### Nesting the selected nodes
Once the nodes are selected, `right click` on any of the selected nodes and select `Nest Selected Nodes` and choose a name that won't conflict with any other existing node. The selected nodes will be replaced with a new node that contains the selected nodes.

### Creating a nested node from the node menu
Nested nodes are saved and can be created again from the node menu that appears when you `right click` on the canvas under the `Nested Nodes` category.

### Where are nested nodes saved?
You can find them under `ComfyUI/custom_nodes/ComfyUI_NestedNodeBuilder/nested_nodes/`. This directory can be changed by editing the `nested_nodes_path` entry in the `config.yaml`. The nested nodes are stored as .json files. The names of the nested nodes may be changed by editing their .json files. The changes made to the directory are registered after refreshing the web UI. 

## How it works
The nodes that are nested are stored in the properties of the nested node. Before the prompt is calculated, the nested node is replaced with the nodes that it stored. After the prompt is calculated, the nodes are nested again. This seemed to be the approach that was the least intrusive on the ComfyUI codebase.

## Problems
- Special nodes such as primitive and reroute nodes cannot be nested.
- Nesting two nodes that have a "control_after_generate" widget will cause the resulting node to keep only one of the widgets, and also corrupts the values of widgets that follow it.
- The green outline that indicates which node is being executed is not shown for nested nodes.
- Nested nodes cannot be nested.
