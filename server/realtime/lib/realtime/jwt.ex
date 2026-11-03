defmodule Realtime.Jwt do
  @moduledoc """
  Validação de JWT emitido pela `clarituz-api` (HS256).

  Mesma política do `JwtIssuer` em Rust: assinatura HMAC-SHA256 com
  `JWT_SECRET` compartilhado, `iss = "clarituz-api"`, `exp` obrigatório.

  Claims esperados: `sub` (id do funcionário), `nivel`, `nome`, `login`.
  """

  @iss "clarituz-api"

  @doc """
  Verifica assinatura, expiração e issuer.

  Retorna `{:ok, claims}` (map de claims) ou `:error` —
  nunca vaza o motivo da rejeição para o cliente.
  """
  @spec verify(binary()) :: {:ok, map()} | :error
  def verify(token) when is_binary(token) do
    signer = Joken.Signer.create("HS256", secret())

    with {:ok, claims} <- Joken.verify(token, signer),
         :ok <- check_exp(claims),
         :ok <- check_iss(claims) do
      {:ok, claims}
    else
      _ -> :error
    end
  end

  def verify(_), do: :error

  defp secret, do: Application.fetch_env!(:realtime, :jwt_secret)

  defp check_exp(%{"exp" => exp}) when is_integer(exp) do
    if exp > System.system_time(:second), do: :ok, else: :error
  end

  defp check_exp(_), do: :error

  defp check_iss(%{"iss" => iss}) when iss == @iss, do: :ok
  defp check_iss(_), do: :error
end
