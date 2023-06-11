import yaml
import shutil
import json
import os
import sys

try:
    dir_path = os.path.dirname(os.path.abspath(__file__))
    sys.path.append(dir_path)
    from directory_paths import ext_path, default_nested_nodes_path, config_path, js_extensions_repo_path
except ImportError as e:
    print(f"[NestedNodeBuilder] Error importing directory_paths.py: {e}")


# Config keys
config_nested_nodes_path = "nested_nodes_path"

# Load config
config = {}
with open(config_path, 'r') as config_file:
    try:
        config = yaml.safe_load(config_file)
    except yaml.YAMLError as yaml_e:
        print("[NestedNodeBuilder] Error loading NestedNodeBuilder config:", yaml_e)


def load_nested_node_defs():
    defs_list = []
    if config_nested_nodes_path not in config:
        print(
            f'[NestedNodeBuilder] missing entry "{config_nested_nodes_path}" in config.yaml, \
            using default path "{default_nested_nodes_path}".'
        )
    nested_nodes_path = config.get(config_nested_nodes_path, default_nested_nodes_path)
    if not os.path.isabs(nested_nodes_path):
        nested_nodes_path = os.path.join(ext_path, nested_nodes_path)
    if not os.path.exists(nested_nodes_path):
        os.makedirs(nested_nodes_path)

    # Load each json file in the nested_nodes_path and add it to the defs list
    for file_name in os.listdir(nested_nodes_path):
        if file_name.endswith(".json"):
            file_path = os.path.join(nested_nodes_path, file_name)
            with open(file_path, 'r') as json_file:
                try:
                    node_def = json.load(json_file)
                except json.JSONDecodeError as json_e:
                    print(f"[NestedNodeBuilder] Error loading {file_name}:", json_e)
                    continue
                if "name" not in node_def:
                    print("[NestedNodeBuilder] missing property \"name\" in node definition:", file_name)
                    continue
                defs_list.append(node_def)
    defs = {}
    for node_def in defs_list:
        key = node_def["name"]
        defs[key] = node_def

    # Add the nested node defs
    # import nodes
    # from .nested_nodes import createNestedNodeClass
    # for node_def in defs_list:
    #     nodes.NODE_CLASS_MAPPINGS[node_def["name"]] = createNestedNodeClass(node_def)
    #     nodes.NODE_DISPLAY_NAME_MAPPINGS[node_def["name"]] = node_def["display_name"]

    return defs


def save_nested_def(node_def):
    if config_nested_nodes_path not in config:
        print(
            f'[NestedNodeBuilder] missing entry "{config_nested_nodes_path}" in config.yaml, \
            using default path "{default_nested_nodes_path}".'
        )
    nested_nodes_path = config.get(config_nested_nodes_path, default_nested_nodes_path)
    if not os.path.isabs(nested_nodes_path):
        nested_nodes_path = os.path.join(ext_path, nested_nodes_path)
    if not os.path.exists(nested_nodes_path):
        os.makedirs(nested_nodes_path)
    file_name = node_def["name"] + ".json"
    file_path = os.path.join(nested_nodes_path, file_name)
    # Raise error if file already exists
    # if os.path.exists(file_path):
    #     raise FileExistsError(f"[NestedNodeBuilder] {file_name} already exists.")
    with open(file_path, 'w') as json_file:
        json.dump(node_def, json_file, indent=4)


def place_js():
    src = os.path.join(ext_path, "js")
    dst = js_extensions_repo_path
    shutil.copytree(src, dst, dirs_exist_ok=True)


def server_add_def_route():
    # TODO: Find a better way to do this

    import server
    from server import web

    # Save original
    add_routes = server.PromptServer.add_routes

    # Wrapper
    def add_routes_wrapper(self):

        # New routes
        @self.routes.get('/nested_node_defs')
        async def get_nested_node_defs(request):
            nested_node_defs = load_nested_node_defs()
            return web.json_response(nested_node_defs)

        @self.routes.post('/nested_node_defs')
        async def save_nested_node_def(request):
            nested_def = await request.json()
            save_nested_def(nested_def)
            return web.Response(text="ok")

        # Add routes
        setattr(self, "get_nested_node_defs", get_nested_node_defs)
        setattr(self, "save_nested_node_def", save_nested_node_def)

        # Call original
        add_routes(self)

    # Replace original
    setattr(server.PromptServer, "add_routes", add_routes_wrapper)


# Can run this script as main to copy the js files to the extensions folder while the server is running
place_js()

if __name__ != "__main__":
    server_add_def_route()

    # This is required so that the extension is displayed as imported successfully
    NODE_CLASS_MAPPINGS = {}
    __all__ = ["NODE_CLASS_MAPPINGS"]
