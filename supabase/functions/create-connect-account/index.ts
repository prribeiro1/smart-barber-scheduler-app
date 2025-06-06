
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
      return new Response(JSON.stringify({ 
        error: "Configuração não encontrada" 
      }), {
        status: 500,
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
      return new Response(JSON.stringify({ 
        error: "Não autenticado" 
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ 
        error: "Usuário não autenticado" 
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Buscar barbearia do usuário
    const { data: barbershop, error: barbershopError } = await supabase
      .from("barbershops")
      .select("id, name")
      .eq("owner_id", user.id)
      .single();

    if (barbershopError || !barbershop) {
      return new Response(JSON.stringify({ 
        error: "Barbearia não encontrada" 
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verificar se já existe conta conectada
    const { data: existingAccount } = await supabase
      .from("stripe_connect_accounts")
      .select("stripe_account_id")
      .eq("barbershop_id", barbershop.id)
      .single();

    if (existingAccount) {
      return new Response(JSON.stringify({ 
        error: "Conta Stripe já existe para esta barbearia" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Criar conta conectada no Stripe
    const account = await stripe.accounts.create({
      type: "express",
      country: "BR",
      email: user.email,
      business_profile: {
        name: barbershop.name,
        product_description: "Serviços de barbearia",
      },
    });

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
        error: "Erro ao salvar conta conectada" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Criar link de onboarding
    const origin = req.headers.get("origin") || "https://lovable.dev";
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${origin}?refresh=true`,
      return_url: `${origin}?setup=complete`,
      type: "account_onboarding",
    });

    return new Response(JSON.stringify({ 
      account_id: account.id,
      onboarding_url: accountLink.url
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Erro na função create-connect-account:", error);
    
    return new Response(JSON.stringify({ 
      error: "Erro interno do servidor",
      details: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
