defmodule RealtimeWeb.ChannelsTest do
  use RealtimeWeb.ChannelCase, async: false

  import Phoenix.ChannelTest

  defp secret, do: Application.fetch_env!(:realtime, :jwt_secret)

  defp token(nivel) do
    signer = Joken.Signer.create("HS256", secret())

    claims = %{
      "sub" => "7",
      "iss" => "clarituz-api",
      "nivel" => nivel,
      "nome" => "Teste",
      "exp" => System.system_time(:second) + 3600
    }

    {:ok, t, _} = Joken.encode_and_sign(claims, signer)
    t
  end

  defp connect_socket(nivel) do
    connect(RealtimeWeb.UserSocket, %{"token" => token(nivel)}, connect_info: %{})
  end

  test "conexão com token válido atribui nivel/id" do
    assert {:ok, socket} = connect_socket(1)
    assert socket.assigns.nivel == 1
    assert socket.assigns.funcionario_id == "7"
  end

  test "conexão com token inválido é recusada" do
    assert :error = connect(RealtimeWeb.UserSocket, %{"token" => "bogus"}, connect_info: %{})
    assert :error = connect(RealtimeWeb.UserSocket, %{}, connect_info: %{})
  end

  test "join em deltas e delta:<tabela>" do
    {:ok, socket} = connect_socket(3)
    assert {:ok, _reply, _socket} = subscribe_and_join(socket, "deltas")
    assert {:ok, _reply, _socket} = subscribe_and_join(socket, "delta:reserva")
  end

  test "join em delta:<tabela inválida> é rejeitado" do
    {:ok, socket} = connect_socket(3)

    assert {:error, %{reason: "tabela inválida"}} =
             subscribe_and_join(socket, "delta:reserva;drop")
  end

  test "aviso é filtrado por nivel no handle_out" do
    {:ok, socket} = connect_socket(3)
    {:ok, _reply, socket} = subscribe_and_join(socket, "avisos")

    # recepção (nivel 3) recebe aviso público
    broadcast_from!(socket, "aviso", %{"ate_nivel" => 3, "titulo" => "x"})
    assert_push "aviso", %{"titulo" => "x"}

    # recepção NÃO recebe aviso de admin (ate_nivel 1)
    broadcast_from!(socket, "aviso", %{"ate_nivel" => 1, "titulo" => "y"})
    refute_push "aviso", %{"titulo" => "y"}
  end

  test "admin (nivel 1) recebe aviso restrito" do
    {:ok, socket} = connect_socket(1)
    {:ok, _reply, socket} = subscribe_and_join(socket, "avisos")

    broadcast_from!(socket, "aviso", %{"ate_nivel" => 1, "titulo" => "adm"})
    assert_push "aviso", %{"titulo" => "adm"}
  end

  test "presenca trackeia o funcionário no join" do
    {:ok, socket} = connect_socket(3)
    {:ok, _reply, _socket} = subscribe_and_join(socket, "presenca")
    assert_push "presence_state", _state
  end
end
