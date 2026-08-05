import type { APIRoute, GetStaticPaths } from "astro";
import {
  getExampleGraphDefinitions,
  type ExampleGraphDefinition,
} from "../../lib/examples";
import type { GraphData } from "../../lib/graph/types";

interface ExampleEndpointProps {
  graph: GraphData;
}

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () =>
  getExampleGraphDefinitions().map((example: ExampleGraphDefinition) => ({
    params: { slug: example.slug },
    props: { graph: example.create() },
  }));

export const GET: APIRoute = ({ props }) => {
  const { graph } = props as ExampleEndpointProps;
  return new Response(JSON.stringify(graph), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
