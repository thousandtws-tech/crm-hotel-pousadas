defmodule Realtime.JwtTest do
  use ExUnit.Case, async: false

  alias Realtime.Jwt

  defp secret, do: Application.fetch_env!(:realtime, :jwt_secret)

  defp sign(claims) do
    signer = Joken.Signer.create("HS256", secret())
    {:ok, token, _claims} = Joken.encode_and_sign(claims, signer)
    token
  end

  defp base_claims(extra \\ %{}) do
    Map.merge(
      %{
        "sub" => "42",
        "iss" => "clarituz-api",
        "nivel" => 3,
        "nome" => "Recepção",
        "login" => "recepcao",
        "exp" => System.system_time(:second) + 3600
      },
      extra
    )
  end

  test "token válido retorna claims" do
    token = sign(base_claims())
    assert {:ok, claims} = Jwt.verify(token)
    assert claims["sub"] == "42"
    assert claims["nivel"] == 3
  end

  test "token expirado é rejeitado" do
    token = sign(base_claims(%{"exp" => System.system_time(:second) - 10}))
    assert :error = Jwt.verify(token)
  end

  test "issuer diferente é rejeitado" do
    token = sign(base_claims(%{"iss" => "outro-servico"}))
    assert :error = Jwt.verify(token)
  end

  test "assinatura com segredo errado é rejeitada" do
    signer = Joken.Signer.create("HS256", "segredo-errado-0123456789abcdef")
    {:ok, token, _} = Joken.encode_and_sign(base_claims(), signer)
    assert :error = Jwt.verify(token)
  end

  test "payload malformado é rejeitado" do
    assert :error = Jwt.verify("nao-e-jwt")
    assert :error = Jwt.verify("")
  end
end
