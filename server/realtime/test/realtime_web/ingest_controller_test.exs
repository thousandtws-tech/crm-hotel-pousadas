defmodule RealtimeWeb.IngestControllerTest do
  use RealtimeWeb.ConnCase, async: false

  defp token, do: Application.fetch_env!(:realtime, :ingest_token)

  defp post_ingest(conn, body, headers \\ []) do
    conn
    |> put_req_header("content-type", "application/json")
    |> then(fn c -> Enum.reduce(headers, c, fn {k, v}, acc -> put_req_header(acc, k, v) end) end)
    |> post("/api/ingest", Jason.encode!(body))
  end

  test "ingest sem token é 401" do
    conn = post_ingest(build_conn(), %{topic: "avisos", event: "aviso", payload: %{}})
    assert response(conn, 401)
  end

  test "ingest com token publica no tópico permitido" do
    Phoenix.PubSub.subscribe(Realtime.PubSub, "avisos")

    conn =
      post_ingest(
        build_conn(),
        %{topic: "avisos", event: "aviso", payload: %{"titulo" => "oi"}},
        [{"x-ingest-token", token()}]
      )

    assert response(conn, 202)
    assert_receive %Phoenix.Socket.Broadcast{event: "aviso", payload: %{"titulo" => "oi"}}
  end

  test "tópico fora da whitelist é 403" do
    conn =
      post_ingest(
        build_conn(),
        %{topic: "room:hack", event: "x", payload: %{}},
        [{"x-ingest-token", token()}]
      )

    assert response(conn, 403)
  end

  test "body malformado é 422" do
    conn =
      post_ingest(build_conn(), %{foo: "bar"}, [{"x-ingest-token", token()}])

    assert response(conn, 422)
  end

  test "health responde ok" do
    conn = get(build_conn(), "/health")
    assert %{"status" => "ok"} = json_response(conn, 200)
  end
end
