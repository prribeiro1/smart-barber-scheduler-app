
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.23.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== CREATE CONNECT ACCOUNT STARTED ===");
    
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!stripeSecretKey || !supabaseUrl || !supabaseKey) {
      console.error("Configuração não encontrada");
      return new Response(JSON.stringify({ 
        error: "Configuração do servidor incompleta" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verificar se a chave do Stripe é válida
    if (!stripeSecretKey.startsWith('sk_')) {
      console.error("Chave do Stripe inválida");
      return new Response(JSON.stringify({ 
        error: "Chave da API do Stripe inválida" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2022-11-15",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Verificar autenticação
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("Header de autorização não encontrado");
      return new Response(JSON.stringify({ 
        error: "Usuário não autenticado" 
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error("Erro de autenticação:", userError);
      return new Response(JSON.stringify({ 
        error: "Usuário não autenticado" 
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Usuário autenticado:", user.email);

    // Buscar barbearia do usuário
    const { data: barbershop, error: barbershopError } = await supabase
      .from("barbershops")
      .select("id, name")
      .eq("owner_id", user.id)
      .single();

    if (barbershopError || !barbershop) {
      console.error("Erro ao buscar barbearia:", barbershopError);
      return new Response(JSON.stringify({ 
        error: "Barbearia não encontrada" 
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Barbearia encontrada:", barbershop.name);

    // Verificar se já existe conta conectada
    const { data: existingAccount } = await supabase
      .from("stripe_connect_accounts")
      .select("stripe_account_id")
      .eq("barbershop_id", barbershop.id)
      .single();

    if (existingAccount) {
      console.log("Conta já existe, criando novo link de onboarding:", existingAccount.stripe_account_id);
      
      try {
        // Verificar se a conta ainda existe no Stripe
        const account = await stripe.accounts.retrieve(existingAccount.stripe_account_id);
        
        // Criar novo link de onboarding mesmo para conta existente
        const origin = req.headers.get("origin") || req.headers.get("referer") || "https://lovable.dev";
        const accountLink = await stripe.accountLinks.create({
          account: existingAccount.stripe_account_id,
          refresh_url: `${origin}/?refresh=true`,
          return_url: `${origin}/?setup=complete`,
          type: "account_onboarding",
        });

        console.log("Novo link de onboarding criado para conta existente");

        return new Response(JSON.stringify({ 
          account_id: existingAccount.stripe_account_id,
          onboarding_url: accountLink.url
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (stripeError) {
        console.error("Erro ao acessar conta existente:", stripeError);
        return new Response(JSON.stringify({ 
          error: "Erro ao acessar conta Stripe existente",
          details: stripeError.message
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Tentar criar conta conectada no Stripe
    try {
      console.log("Criando conta conectada no Stripe...");
      
      const account = await stripe.accounts.create({
        type: "express",
        country: "BR",
        email: user.email,
        business_profile: {
          name: barbershop.name,
          product_description: "Serviços de barbearia",
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      console.log("Conta criada no Stripe:", account.id);

      // Salvar no banco
      const { error: insertError } = await supabase
        .from("stripe_connect_accounts")
        .insert({
          barbershop_id: barbershop.id,
          stripe_account_id: account.id,
          account_status: "pending",
        });

      if (insertError) {
        console.error("Erro ao salvar conta conectada:", insertError);
        return new Response(JSON.stringify({ 
          error: "Erro ao salvar conta conectada: " + insertError.message 
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Criar link de onboarding
      const origin = req.headers.get("origin") || req.headers.get("referer") || "https://lovable.dev";
      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${origin}/?refresh=true`,
        return_url: `${origin}/?setup=complete`,
        type: "account_onboarding",
      });

      console.log("Link de onboarding criado");

      return new Response(JSON.stringify({ 
        account_id: account.id,
        onboarding_url: accountLink.url
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (stripeError) {
      console.error("Erro específico do Stripe:", stripeError);
      
      // Tratar erros específicos do Stripe de forma mais detalhada
      if (stripeError.message?.includes('platform profile')) {
        return new Response(JSON.stringify({ 
          error: "CONFIGURAÇÃO NECESSÁRIA: Você precisa completar o perfil da sua plataforma no Stripe Connect.",
          details: "Acesse https://dashboard.stripe.com/settings/connect/platform-profile e complete todas as seções obrigatórias.",
          stripe_error: stripeError.message,
          action_required: "platform_profile"
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (stripeError.message?.includes('losses')) {
        return new Response(JSON.stringify({ 
          error: "CONFIGURAÇÃO NECESSÁRIA: Você precisa revisar as responsabilidades de perdas para contas conectadas.",
          details: "Acesse https://dashboard.stripe.com/settings/connect/platform-profile e complete a seção 'Loss liability'.",
          stripe_error: stripeError.message,
          action_required: "loss_liability"
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ 
        error: "Erro na criação da conta Stripe",
        details: stripeError.message,
        stripe_error: stripeError.message
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (error) {
    console.error("Erro geral na função create-connect-account:", error);
    
    return new Response(JSON.stringify({ 
      error: "Erro interno do servidor",
      details: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
